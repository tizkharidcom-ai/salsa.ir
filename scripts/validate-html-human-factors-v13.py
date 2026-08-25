from html.parser import HTMLParser
from pathlib import Path
from collections import Counter
import re,sys,json
ROOT=Path(__file__).resolve().parents[1]
pages=sorted(ROOT.glob('*.html'))
class Audit(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True); self.tags=Counter(); self.ids=[]; self.target_blank=[]; self.href_hash=[]; self.viewport=[]; self.theme=False
    def handle_starttag(self,tag,attrs):
        d=dict(attrs); self.tags[tag]+=1
        if d.get('id'):self.ids.append(d['id'])
        if tag=='a' and d.get('href')=='#':self.href_hash.append(d)
        if tag=='a' and d.get('target')=='_blank':self.target_blank.append(d)
        if tag=='meta' and d.get('name')=='viewport':self.viewport.append(d.get('content',''))
        if tag=='meta' and d.get('name')=='theme-color':self.theme=True
checks=[]
def add(page,name,ok,evidence=''):checks.append({'page':page,'name':name,'pass':bool(ok),'evidence':evidence})
for p in pages:
    a=Audit(); a.feed(p.read_text(errors='ignore'))
    add(p.name,'exactly one main',a.tags['main']==1,str(a.tags['main']))
    add(p.name,'exactly one static H1',a.tags['h1']==1,str(a.tags['h1']))
    add(p.name,'theme-color present',a.theme)
    dup=[k for k,v in Counter(a.ids).items() if v>1]; add(p.name,'unique ids',not dup,','.join(dup))
    add(p.name,'no href=# action placeholder',not a.href_hash,str(len(a.href_hash)))
    unsafe=[x for x in a.target_blank if 'noopener' not in str(x.get('rel','')).split()]
    add(p.name,'target blank noopener',not unsafe,str(len(unsafe)))
    bad=[x for x in a.viewport if 'user-scalable=no' in x or re.search(r'maximum-scale\s*=\s*1(?:\D|$)',x)]
    add(p.name,'user zoom not blocked',not bad,';'.join(bad))
fail=[x for x in checks if not x['pass']]
print(json.dumps({'pass':len(checks)-len(fail),'fail':len(fail),'failures':fail},ensure_ascii=False,indent=2))
sys.exit(1 if fail else 0)
