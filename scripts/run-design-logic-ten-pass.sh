#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
LOG="$ROOT/docs/design-logic-v12.9/TEN-PASS-RUN.log"
: > "$LOG"
runq(){
  local label="$1"; shift
  local tmp
  tmp="$(mktemp)"
  if "$@" >"$tmp" 2>&1; then
    printf '  PASS %-34s\n' "$label" >> "$LOG"
  else
    printf '  FAIL %-34s\n' "$label" >> "$LOG"
    cat "$tmp" >> "$LOG"
    cat "$tmp" >&2
    rm -f "$tmp"
    return 1
  fi
  rm -f "$tmp"
}
for pass in $(seq 1 10); do
  printf 'PASS %02d\n' "$pass" >> "$LOG"
  runq 'design-logic 63 checks' node scripts/validate-design-logic-v12.9.js
  runq 'production 36 checks' node scripts/validate-production-v12.js
  runq 'performance 28 checks' node scripts/validate-performance-v12.js
  runq 'stability 28 checks' node scripts/validate-stability-final.js
  runq 'full review 59 checks' node scripts/validate-full-review.js
  runq 'responsive geometry matrix' node scripts/validate-responsive-geometry.js
  runq 'smart loading 66 checks' node scripts/validate-smart-loading.js
  runq 'cleanup 34 checks' node scripts/validate-cleanup.js
  runq 'admin center 35 checks' node scripts/validate-admin-center.js
  runq 'admin 1000 34 checks' node scripts/validate-admin-1000.js
  runq 'category resource stability' node scripts/test-category-resource-stability.js
  runq 'project tests' npm test
  runq 'production UI syntax' node --check js/westo-production-v12.js
  runq 'cart syntax' node --check js/table-cart.js
  runq 'classic menu syntax' node --check js/classic-menu.js
  runq 'i18n syntax' node --check js/i18n.js
  runq 'checkout syntax' node --check js/checkout.js
  runq 'smart app syntax' node --check js/westo-app.smart.js
  runq 'CSS parser source+smart' python3 -c "import tinycss2,pathlib,sys; p=pathlib.Path('.'); fs=['css/westo-production-v12.css','css/checkout.css','css/panel.css','css/westo-critical.smart.css']; e=[]; [(e.extend([(f,x.message,x.source_line) for x in tinycss2.parse_stylesheet((p/f).read_text(encoding='utf-8'),skip_whitespace=True,skip_comments=True) if x.type=='error'])) for f in fs]; print(e); sys.exit(bool(e))"
  printf '  RESULT CLEAN\n\n' >> "$LOG"
done
printf 'TEN_PASS_RESULT=PASS\n' >> "$LOG"
cat "$LOG"
