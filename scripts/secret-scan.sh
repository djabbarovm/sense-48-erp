#!/usr/bin/env bash
# G-01: доменный secret-scan (docs/11): в репозитории не должно быть
# полных номеров карт, приватных ключей, реальных ИНН-паролей, .env c ключами.
set -euo pipefail
cd "$(dirname "$0")/.."
fail=0

# приватные ключи
if grep -rn --include='*' -l "BEGIN RSA PRIVATE KEY\|BEGIN PRIVATE KEY\|BEGIN OPENSSH PRIVATE KEY" \
  --exclude-dir=node_modules --exclude-dir=.git --exclude=secret-scan.sh . ; then
  echo "FAIL: найден приватный ключ"; fail=1
fi

# полные номера карт (16 цифр c префиксами УЗ-карт/Visa/MC), кроме тестовых счетов 2020…
if grep -rnE --include='*.ts' --include='*.tsx' --include='*.json' --include='*.md' \
  --exclude-dir=node_modules --exclude-dir=.git \
  '\b(8600|9860|5614|4[0-9]{3}|5[1-5][0-9]{2})[0-9]{12}\b' . | grep -v '2020[0-9]\{16\}' ; then
  echo "FAIL: похоже на полный номер карты"; fail=1
fi

# .env не должен коммититься
if git ls-files | grep -E '(^|/)\.env$' ; then
  echo "FAIL: .env в индексе git"; fail=1
fi

if [ "$fail" -eq 0 ]; then echo "secret-scan: OK"; fi
exit $fail
