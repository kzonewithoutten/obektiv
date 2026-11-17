#!/usr/bin/env bash
# Привязать свой домен к сайту и включить HTTPS:
#   bash /var/www/obektiv/deploy/set-domain.sh obektiv-foto.ru
# Перед запуском: в DNS домена добавьте A-запись на IP сервера (см. README).
set -euo pipefail
DOMAIN="${1:-}"
APP=/var/www/obektiv
NGINX=/etc/nginx/sites-enabled/nodejs
say() { printf '\n\033[1;35m▸ %s\033[0m\n' "$1"; }
die() { printf '\n\033[1;31m✖ %s\033[0m\n' "$1"; exit 1; }

[ "$(id -u)" = 0 ] || die "Запустите от root"
[[ "$DOMAIN" =~ ^([a-z0-9-]+\.)+[a-z]{2,}$ ]] || die "Укажите домен без http:// и без www, например obektiv-foto.ru"
[ -f "$NGINX" ] || die "Не найден файл nginx $NGINX"

IP=$(curl -fsS https://api.ipify.org || echo "")
RESOLVED=$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1 || true)
if [ -z "$RESOLVED" ]; then
  die "Домен $DOMAIN пока не указывает на сервер. В DNS добавьте A-запись: $DOMAIN → ${IP:-IP-сервера}, и подождите 10–30 минут"
fi
if [ -n "$IP" ] && [ "$RESOLVED" != "$IP" ]; then
  die "Домен указывает на $RESOLVED, а сервер — на $IP. Исправьте A-запись в DNS"
fi

say "Добавляю домен в настройки nginx"
cp --dereference "$NGINX" "/root/nginx-nodejs.before-domain-$(date +%F-%H%M)"
if ! grep -q " $DOMAIN" "$NGINX"; then
  sed -i --follow-symlinks "s/server_name \(.*\);/server_name \1 $DOMAIN www.$DOMAIN;/" "$NGINX"
fi

if ! command -v certbot >/dev/null; then
  say "Ставлю certbot (бесплатные сертификаты Let's Encrypt)"
  apt-get update -qq && apt-get install -y -qq certbot python3-certbot-nginx
fi

say "Получаю сертификат HTTPS и включаю переадресацию с http"
nginx -t
certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" --non-interactive --agree-tos --redirect \
  --register-unsafely-without-email || die "Не получилось выпустить сертификат. Проверьте, что домен открывается по http и DNS уже обновился"
nginx -t && systemctl reload nginx

say "Говорю сайту его новый адрес (для поиска, карты сайта и превью)"
sed -i "s|PORT: 3000,|PORT: 3000,\n        SITE_URL: 'https://$DOMAIN',|" "$APP/deploy/ecosystem.config.js"
chown nodejs "$APP/deploy/ecosystem.config.js"
runuser -u nodejs -- env HOME=/home/nodejs pm2 delete obektiv >/dev/null 2>&1 || true
runuser -u nodejs -- env HOME=/home/nodejs pm2 start "$APP/deploy/ecosystem.config.js" >/dev/null
runuser -u nodejs -- env HOME=/home/nodejs pm2 save >/dev/null

printf '\n\033[1;32m✔ Готово: https://%s\033[0m\n' "$DOMAIN"
echo "Проверьте в браузере (и на iPhone): https://$DOMAIN и https://www.$DOMAIN"
echo "Старый адрес тоже будет работать. Чтобы поиск видел новый, добавьте https://$DOMAIN в Яндекс Вебмастер и Google Search Console."
