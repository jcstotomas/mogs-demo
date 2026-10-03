"""Generate the frozen synthetic lab corpus. Requires reportlab and Pillow.
Do not change expected outcomes to accommodate evaluation failures.
"""
import sys,json,hashlib,html,os
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from PIL import Image,ImageDraw,ImageFont,ImageFilter
if os.environ.get('MOGS_MULTICHANNEL_ENABLED') != '1': raise SystemExit('Multichannel lab is disabled.')
root=Path(sys.argv[1]); root.mkdir(parents=True,exist_ok=True)
if (root/'manifest.json').exists(): raise SystemExit('Refusing to overwrite the frozen manifest. Use existing fixture bytes.')
entries=[]
def context(title,audience='unspecified',legacy=None,**kw):
    return dict(title=title,audience=audience,legacyEligible=legacy,journey='',subject='',preheader='',plainText='',region='US',date='2026-10-03',**kw)
def expected(text,label,replacement=None,**kw):
    item=dict(text=text,label=label,**kw)
    if replacement is not None:item['replacement']=replacement
    return item
def add(filename,surface,ctx,cases,pages=1):
    b=(root/filename).read_bytes()
    entries.append(dict(filename=filename,surface=surface,context=ctx,sha256=hashlib.sha256(b).hexdigest(),pages=pages,expected=cases))
# The two email bodies are byte-identical; only explicit eligibility differs.
paired=[
 'Hello {{ first_name }}, Starter is $30 a month.',
 'Starter costs about a dollar a day.',
 'Save 20% on Starter with annual billing.',
 'Team is only $50 a month more than Starter.',
 'Starter is $288 a year, or $24 a month billed annually.',
 'The Locations add-on is $30 a month.',
 'Plans from $30.',
 'Thanks, Zoë — let’s make scheduling easier.',
]
def write_email(filename,title,lines,conditional=False):
    body='\n'.join('<p>'+html.escape(line)+'</p>' for line in lines)
    if conditional: body='{% if subscriber.active %}\n'+body+'\n{% else %}<p>Check your account terms.</p>{% endif %}'
    source='<!doctype html><html><head><meta charset="utf-8"><title>'+title+'</title></head><body><h1>'+title+'</h1>'+body+'<p><a href="https://example.invalid/start?price=30&amp;utm_source=lab">Open your account</a></p><img src="https://example.invalid/tracker.gif" alt=""><script>window.fixtureTracking=true;</script></body></html>\n'
    (root/filename).write_text(source,encoding='utf8')
for name,audience,legacy in [('email-new.html','new_customers',False),('email-legacy.html','existing_customers',True)]:
    write_email(name,'Your MOGS plan',paired)
    cases=[]
    for old,new in zip(paired[:4],['Hello {{ first_name }}, Starter is $40 a month.','Starter costs about $1.33 a day.','Save 40% on Starter with annual billing.','Team is only $40 a month more than Starter.']):
        cases.append(expected(old,'valid_exception' if legacy else 'contradicting',None if legacy else new))
    cases += [expected(paired[4],'consistent'),expected(paired[5],'unrelated'),expected(paired[6],'insufficient_context')]
    ctx=context('Your MOGS plan',audience,legacy)
    ctx.update(subject='Starter is $30 a month.',preheader='Save 20% on Starter with annual billing.',plainText='Starter is $30 a month.')
    # Subject and plain-text occurrences remain separate in the denominator.
    cases += [expected('Starter is $30 a month.','valid_exception' if legacy else 'contradicting',None if legacy else 'Starter is $40 a month.',field='subject'),expected('Save 20% on Starter with annual billing.','valid_exception' if legacy else 'contradicting',None if legacy else 'Save 40% on Starter with annual billing.',field='preheader'),expected('Starter is $30 a month.','valid_exception' if legacy else 'contradicting',None if legacy else 'Starter is $40 a month.',field='plainText')]
    add(name,'email',ctx,cases)
mixed=['Starter is $30 a month for new customers.','Starter is $30 a month for legacy-eligible subscribers.','Starter is $288 a year, or $24 a month billed annually.','The Locations add-on is $30 a month.','Plans from $30.']
write_email('email-mixed.html','Offer comparison',mixed)
add('email-mixed.html','email',context('Offer comparison','existing_customers',True),[expected(mixed[0],'contradicting',mixed[0].replace('$30','$40')),expected(mixed[1],'valid_exception'),expected(mixed[2],'consistent'),expected(mixed[3],'unrelated'),expected(mixed[4],'insufficient_context')])
branch=['Starter is $30 a month.','Save 20% on Starter with annual billing.','Plans from $30.']
write_email('email-conditional.html','Conditional renewal',branch,True)
add('email-conditional.html','email',context('Conditional renewal','existing_customers',None),[expected(x,'insufficient_context') for x in branch])

# Real PDF exports. Pricing is printed as text; locations are recovered by the parser.
def pdf(filename,pages):
    doc=canvas.Canvas(str(root/filename),pagesize=(1100,720),pageCompression=1,invariant=1)
    doc.setTitle('MOGS fictional company - synthetic '+filename)
    for index,(title,lines,footnote) in enumerate(pages):
        doc.setFillColor(HexColor('#f8f6f0'));doc.rect(0,0,1100,720,fill=1,stroke=0)
        doc.setFillColor(HexColor('#244d40'));doc.setFont('Helvetica-Bold',17);doc.drawString(60,672,'MOGS / FICTIONAL COMPANY / SYNTHETIC FIXTURE')
        doc.setFillColor(HexColor('#202820'));doc.setFont('Helvetica-Bold',36);doc.drawString(60,610,title)
        y=535
        for line in lines:
            doc.setFont('Helvetica',25);doc.drawString(60,y,line);y-=61
        if footnote:
            doc.setFont('Helvetica',18);doc.setFillColor(HexColor('#405345'));doc.drawString(60,94,footnote)
        doc.setFont('Helvetica',14);doc.drawString(60,40,'Exported PDF evidence only. No native slide editing.');doc.drawRightString(1040,40,str(index+1));doc.showPage()
    doc.save()
pages=[('New customer pricing',['Starter is $30 a month.','Save 20% on Starter with annual billing.','Starter monthly | $30','The Locations add-on is $30 a month.','Plans from $30.'],None),('New customer plan comparison',['Starter is $30 a month.','Starter costs about a dollar a day.','Team is only $50 a month more than Starter.','A calmer way to schedule work across teams.','Choose a plan that fits the way you collaborate.'],None)]
pdf('deck-new.pdf',pages)
add('deck-new.pdf','deck',context('New customer sales overview','new_customers',False),[
 expected('Starter is $30 a month.','contradicting','Starter is $40 a month.',page=1),expected('Save 20% on Starter with annual billing.','contradicting','Save 40% on Starter with annual billing.'),expected('Starter monthly | $30','contradicting','Starter monthly | $40'),expected('The Locations add-on is $30 a month.','unrelated'),expected('Plans from $30.','insufficient_context'),expected('Starter is $30 a month.','contradicting','Starter is $40 a month.',page=2),expected('Starter costs about a dollar a day.','contradicting','Starter costs about $1.33 a day.'),expected('Team is only $50 a month more than Starter.','contradicting','Team is only $40 a month more than Starter.')],2)
legacy_note='Only active Starter monthly subscribers who subscribed before 2026-09-01 keep this rate.'
pdf('deck-legacy.pdf',[('Subscriber continuation',['Starter is $30 a month.','Starter is $288 a year, or $24 a month billed annually.','The Locations add-on is $30 a month.','Plans from $30.'],legacy_note)])
add('deck-legacy.pdf','deck',context('Subscriber continuation','existing_customers',True),[expected('Starter is $30 a month.','valid_exception'),expected('Starter is $288 a year, or $24 a month billed annually.','consistent'),expected('The Locations add-on is $30 a month.','unrelated'),expected('Plans from $30.','insufficient_context')])
pdf('deck-history.pdf',[('Product milestones',['When we launched in 2023, Starter cost $30 a month.','Starter is $288 a year, or $24 a month billed annually.','The Locations add-on is $30 a month.','Plans from $30.'],None)])
add('deck-history.pdf','deck',context('Product milestones','new_customers',False),[expected('When we launched in 2023, Starter cost $30 a month.','valid_exception'),expected('Starter is $288 a year, or $24 a month billed annually.','consistent'),expected('The Locations add-on is $30 a month.','unrelated'),expected('Plans from $30.','insufficient_context')])
pdf('deck-unclear.pdf',[('Needs audience review',['Starter is $30 a month.','Starter is under $35 a month, billed monthly for new customers.','Starter is $288 a year, or $24 a month billed annually.','The Locations add-on is $30 a month.','Plans from $30.'],None)])
# A public statement on the same page conflicts with the unqualified monthly offer;
# the unqualified direct claim remains insufficient, not inferred public.
add('deck-unclear.pdf','deck',context('Needs audience review','existing_customers',None),[expected('Starter is $30 a month.','insufficient_context'),expected('Starter is under $35 a month, billed monthly for new customers.','contradicting'),expected('Starter is $288 a year, or $24 a month billed annually.','consistent'),expected('The Locations add-on is $30 a month.','unrelated'),expected('Plans from $30.','insufficient_context')])

font_path='/System/Library/Fonts/Supplemental/Arial.ttf'
bold_path='/System/Library/Fonts/Supplemental/Arial Bold.ttf'
def font(size,bold=False):return ImageFont.truetype(bold_path if bold else font_path,size)
def creative(filename,title,lines,footnote=None):
    img=Image.new('RGB',(1900,1120),'#f8f6f0');draw=ImageDraw.Draw(img)
    draw.rectangle((0,0,28,1120),fill='#244d40');draw.text((86,60),'MOGS / FICTIONAL COMPANY / SYNTHETIC FIXTURE',font=font(29,True),fill='#244d40')
    draw.text((86,136),title,font=font(67,True),fill='#202820')
    y=280
    for line in lines:draw.text((86,y),line,font=font(45),fill='#202820');y+=132
    if footnote:draw.text((86,913),footnote,font=font(31),fill='#405345')
    draw.text((86,1040),'Static creative. Annotated suggestions only.',font=font(25),fill='#405345')
    img.save(root/filename,quality=97,optimize=False)
creative('creative-new.png','New customer offer',['Starter is $30 a month.','Starter costs about a dollar a day.','The Locations add-on is $30 a month.','Plans from $30.'])
add('creative-new.png','creative',context('New customer offer','new_customers',False),[expected('Starter is $30 a month.','contradicting','Starter is $40 a month.'),expected('Starter costs about a dollar a day.','contradicting','Starter costs about $1.33 a day.'),expected('The Locations add-on is $30 a month.','unrelated'),expected('Plans from $30.','insufficient_context')])
creative('creative-legacy.png','Your existing subscription',['Starter is $30 a month.','Starter is $288 a year, or $24 a month billed annually.','The Locations add-on is $30 a month.','Plans from $30.'],'For legacy-eligible subscribers only.')
add('creative-legacy.png','creative',context('Your existing subscription','existing_customers',True),[expected('Starter is $30 a month.','valid_exception'),expected('Starter is $288 a year, or $24 a month billed annually.','consistent'),expected('The Locations add-on is $30 a month.','unrelated'),expected('Plans from $30.','insufficient_context')])
creative('creative-savings.jpg','New customer plan comparison',['Save 20% on Starter with annual billing.','Team is only $50 a month more than Starter.','Starter is $288 a year, or $24 a month billed annually.','Plans from $30.'])
add('creative-savings.jpg','creative',context('New customer plan comparison','new_customers',False),[expected('Save 20% on Starter with annual billing.','contradicting','Save 40% on Starter with annual billing.'),expected('Team is only $50 a month more than Starter.','contradicting','Team is only $40 a month more than Starter.'),expected('Starter is $288 a year, or $24 a month billed annually.','consistent'),expected('Plans from $30.','insufficient_context')])
creative('creative-ambiguous.png','A flexible plan for your team',['Starter is $30 a month.','Starter is $288 a year, or $24 a month billed annually.','The Locations add-on is $30 a month.','Plans from $30.'])
add('creative-ambiguous.png','creative',context('Campaign missing eligibility','existing_customers',None),[expected('Starter is $30 a month.','insufficient_context'),expected('Starter is $288 a year, or $24 a month billed annually.','consistent'),expected('The Locations add-on is $30 a month.','unrelated'),expected('Plans from $30.','insufficient_context')])
(root/'faults').mkdir(exist_ok=True)
(root/'faults/malformed.pdf').write_bytes(b'%PDF-1.7\nnot a valid PDF\n')
(root/'faults/mismatched.png').write_text('<html><p>Starter is $30 a month.</p></html>')
Image.new('RGB',(1200,800),'white').save(root/'faults/blank.png')
blur=Image.new('RGB',(1200,800),'white');bd=ImageDraw.Draw(blur);bd.text((40,280),'Starter is $30 a month.',font=font(20),fill='#dadada');blur.filter(ImageFilter.GaussianBlur(7)).save(root/'faults/blurry.png')
manifest=dict(version='mogs-lab-fixtures-v1',frozenAt='2026-10-03',author='Codex-generated synthetic fixtures',scope='Independent experimental regression corpus; no launch gate credit.',expectedAssetCount=12,expectedSurfaces=dict(email=4,deck=4,creative=4),assets=entries,faultInputs=[dict(filename='faults/malformed.pdf',expected='failed',reason='Invalid PDF syntax'),dict(filename='faults/mismatched.png',expected='failed',reason='PNG extension with HTML bytes'),dict(filename='faults/blank.png',expected='partial_or_failed',reason='No extractable text'),dict(filename='faults/blurry.png',expected='partial_or_failed',reason='Unreadable low-contrast text')])
(root/'manifest.json').write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+'\n')
for e in entries:(root/(e['filename']+'.context.json')).write_text(json.dumps(e['context'],indent=2,ensure_ascii=False)+'\n')
print(json.dumps(dict(assets=len(entries),bySurface=manifest['expectedSurfaces'],expectedClaims=sum(len(e['expected']) for e in entries),manifestHash=hashlib.sha256((root/'manifest.json').read_bytes()).hexdigest())))
