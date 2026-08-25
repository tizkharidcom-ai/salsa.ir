from pathlib import Path
from bs4 import BeautifulSoup
import re, sys
ROOT=Path(__file__).resolve().parents[1]
pages=sorted(ROOT.glob('*.html'))
checks=[]
def add(name,ok,detail=''):
    checks.append((name,bool(ok),detail))
for p in pages:
    soup=BeautifulSoup(p.read_text(encoding='utf-8',errors='ignore'),'html.parser')
    add(f'{p.name}: exactly one main',len(soup.find_all('main'))==1)
    add(f'{p.name}: exactly one h1',len(soup.find_all('h1'))==1)
    add(f'{p.name}: buttons explicit type',all(b.get('type') for b in soup.find_all('button')))
    add(f'{p.name}: images have alt',all(i.get('alt') is not None for i in soup.find_all('img')))
    add(f'{p.name}: no dead href hash',not any(a.get('href')=='#' for a in soup.find_all('a')))

prod=(ROOT/'css/westo-production-v12.css').read_text()
promo=(ROOT/'css/menu-promo-deck.css').read_text()
add('global horizontal overflow guard', 'overflow-x:hidden !important' in prod and '@supports (overflow:clip)' in prod)
add('global focus-visible treatment', 'button:focus-visible' in prod)
add('category hero mobile arrows non-duplicative', 'carousel_arrow { display:none !important; }' in promo)
add('promo uses touch-safe share', 'width:44px;height:44px' in promo)
add('promo dots have touch hit area', 'width:32px;height:32px' in promo)
add('touch category surfaces avoid backdrop readback', 'WESTO v13.9 — CATEGORY INDEX DOCK LITE' in prod and 'WESTO v13.7 — CATEGORY HEADER LITE' in prod)
add('promo no viewport-fixed collision', re.search(r'#westo-menu-promo-deck\.westo-menu-promo-deck\s*\{[^}]*position:\s*absolute',promo,re.S))

failed=[x for x in checks if not x[1]]
for n,ok,d in checks: print(('PASS' if ok else 'FAIL'),n,d)
print(f'\nDesign-system structural audit v13.9: {len(checks)-len(failed)}/{len(checks)} PASS')
sys.exit(1 if failed else 0)
