#!/usr/bin/env bash
# ============================================================
#  Установка и обновление сайта «Объектив» на Beget VPS (Node.js)
#
#  Использование (под root):
#     bash install.sh /root/obektiv.zip
#
#  Первый запуск — установит сайт.
#  Каждый следующий — обновит код. Заказы, фото, цены и настройки
#  лежат в /var/lib/obektiv и при обновлении НЕ меняются.
# ============================================================
set -euo pipefail

ZIP="${1:-/root/obektiv.zip}"
APP=/var/www/obektiv
DATA=/var/lib/obektiv
BACKUPS=/var/backups/obektiv
RUN_USER=nodejs
NGINX_CONF=""
for f in /etc/nginx/sites-enabled/nodejs /etc/nginx/sites-enabled/nodejs.conf /etc/nginx/sites-available/nodejs.conf /etc/nginx/sites-available/nodejs; do
  [ -f "$f" ] && { NGINX_CONF="$f"; break; }
done

as_user() {
  if command -v sudo >/dev/null; then sudo -u "$RUN_USER" -H "$@"
  else runuser -u "$RUN_USER" -- env HOME="$(getent passwd "$RUN_USER" | cut -d: -f6)" "$@"; fi
}
say() { printf '\n\033[1;35m▸ %s\033[0m\n' "$1"; }
die() { printf '\n\033[1;31m✖ %s\033[0m\n' "$1"; exit 1; }

[ "$(id -u)" = 0 ] || die "Запустите от root (или через sudo)"
[ -f "$ZIP" ] || die "Не найден архив $ZIP. Загрузите obektiv.zip в /root и запустите снова"
id "$RUN_USER" >/dev/null 2>&1 || die "Нет пользователя $RUN_USER. Нужен VPS с готовым решением Node.js из маркетплейса Beget"

NODE_MAJOR=$(node -v 2>/dev/null | sed 's/^v\([0-9]*\).*/\1/')
[ -n "$NODE_MAJOR" ] && [ "$NODE_MAJOR" -ge 22 ] || die "Нужен Node.js 22 или новее (сейчас: $(node -v 2>/dev/null || echo 'не установлен'))"
command -v unzip >/dev/null || { say "Ставлю unzip"; apt-get update -qq && apt-get install -y -qq unzip; }

say "Распаковываю новую версию"
TMP=$(mktemp -d)
unzip -q "$ZIP" -d "$TMP"
SRC="$TMP/obektiv"
[ -f "$SRC/server.js" ] || die "В архиве нет папки obektiv с server.js"
rm -rf "$SRC/data"

# Если когда-то запускали без отдельной папки данных — переносим их
mkdir -p "$DATA" "$BACKUPS"
if [ -d "$APP/data" ] && [ ! -f "$DATA/obektiv.db" ]; then
  say "Переношу старые данные в $DATA"
  cp -a "$APP/data/." "$DATA/"
fi

FIRST_INSTALL=0
[ -f "$DATA/obektiv.db" ] || FIRST_INSTALL=1

say "Заменяю код сайта"
mkdir -p "$(dirname "$APP")"
rm -rf "$APP.new" "$APP.old"
cp -a "$SRC" "$APP.new"
[ -d "$APP" ] && mv "$APP" "$APP.old"
mv "$APP.new" "$APP"
rm -rf "$APP.old" "$TMP"
chown -R "$RUN_USER:$RUN_USER" "$APP" "$DATA"
chmod +x "$APP/deploy/"*.sh

say "Настраиваю nginx (большие фото, долгая загрузка с телефона)"
if [ -n "$NGINX_CONF" ]; then
  # Beget иногда направляет сайт в сокет вместо порта — переключаем на порт 3000
  if grep -q 'proxy_pass http://unix:' "$NGINX_CONF"; then
    cp --dereference "$NGINX_CONF" "/root/nginx-nodejs.bak-$(date +%F)"
    sed -i --follow-symlinks 's#proxy_pass http://unix:[^;]*;#proxy_pass http://127.0.0.1:3000;#' "$NGINX_CONF"
  fi
  if ! grep -q 'client_max_body_size' "$NGINX_CONF"; then
    cp --dereference "$NGINX_CONF" "/root/nginx-nodejs.bak2-$(date +%F)"
    sed -i --follow-symlinks '/proxy_pass/a\        client_max_body_size 64m;\n        proxy_request_buffering off;\n        proxy_read_timeout 900s;\n        proxy_send_timeout 900s;' "$NGINX_CONF"
    grep -q 'proxy_set_header Host' "$NGINX_CONF" || sed -i --follow-symlinks '/proxy_pass/a\        proxy_set_header Host $host;' "$NGINX_CONF"
    grep -q 'X-Forwarded-Proto' "$NGINX_CONF" || sed -i --follow-symlinks '/proxy_pass/a\        proxy_set_header X-Forwarded-Proto $scheme;' "$NGINX_CONF"
    if nginx -t 2>/dev/null; then nginx -s reload; else
      cp "/root/nginx-nodejs.bak2-$(date +%F)" "$(readlink -f "$NGINX_CONF")"
      die "nginx не принял настройки, вернул как было. Напишите в поддержку Beget: нужно client_max_body_size 64m"
    fi
  fi
else
  echo "  Настройки nginx не найдены — пропускаю. Без этой настройки фото больше 1 МБ не загрузятся."
fi

say "Запускаю сайт"
as_user pm2 delete hello-world >/dev/null 2>&1 || true
if as_user pm2 describe obektiv >/dev/null 2>&1; then
  as_user pm2 delete obektiv >/dev/null
fi
as_user pm2 start "$APP/deploy/ecosystem.config.js" >/dev/null
as_user pm2 save >/dev/null

# Короткая команда для следующих обновлений
cat > /usr/local/bin/obektiv-update <<UPD
#!/bin/sh
exec bash $APP/deploy/install.sh "\${1:-/root/obektiv.zip}"
UPD
chmod +x /usr/local/bin/obektiv-update
cat > /usr/local/bin/obektiv-admin <<ADM
#!/bin/sh
exec bash $APP/deploy/make-admin.sh "\$@"
ADM
chmod +x /usr/local/bin/obektiv-admin

say "Включаю ежедневную копию заказов и фото"
cat > /etc/cron.daily/obektiv-backup <<CRON
#!/bin/sh
$APP/deploy/backup.sh >/dev/null 2>&1
CRON
chmod +x /etc/cron.daily/obektiv-backup

sleep 2
if curl -fsS -o /dev/null http://127.0.0.1:3000/; then
  printf '\n\033[1;32m✔ Сайт работает.\033[0m\n'
else
  echo "Сайт не ответил. Посмотрите ошибки: sudo -u $RUN_USER pm2 logs obektiv"
fi

if [ "$FIRST_INSTALL" = 1 ]; then
  echo
  as_user pm2 logs obektiv --lines 30 --nostream 2>/dev/null | grep -E 'Логин|Пароль' | sed 's/^.*|\s*//' || true
  echo "Сохраните пароль администратора! Вход: ваш-сайт/admin"
fi
echo
echo "Чтобы обновить сайт потом: загрузите новый obektiv.zip в /root и выполните  obektiv-update"
