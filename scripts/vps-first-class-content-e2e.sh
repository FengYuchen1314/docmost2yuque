#!/usr/bin/env bash
set -Eeuo pipefail
trap 'echo "First-class content E2E failed at line $LINENO" >&2' ERR
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.."&&pwd)";jar="${API_JAR:-$root/backend/app-api/build/libs/knowledge-platform-api.jar}";[[ -f "$jar" ]];suffix="kp-fc-e2e-$(date +%s)-$$";net="$suffix-net";db="$suffix-db";api="$suffix-api";tmp="$(mktemp -d /tmp/kp-fc-e2e.XXXXXX)";internal="$(openssl rand -hex 32)"
cleanup(){ docker rm -f "$api" "$db" >/dev/null 2>&1||true;docker network rm "$net" >/dev/null 2>&1||true;case "$tmp" in /tmp/kp-fc-e2e.*)rm -rf -- "$tmp";;esac;};trap cleanup EXIT
wait_for(){ local label="$1";shift;for _ in $(seq 1 90);do "$@" >/dev/null 2>&1&&return;sleep 1;done;echo "timeout $label";docker logs "$api";return 1;};val(){ python3 -c 'import json,sys;print(json.load(sys.stdin)[sys.argv[1]])' "$1";};post(){ local path="$1" data="$2" out="$3";curl -sS -o "$out" -w '%{http_code}' -b "$cookie" -H "$header: $token" -H 'Content-Type: application/json' --data-binary "$data" "$url$path";};download(){ curl -fsS -b "$cookie" "$url/api/v1/content-transfers/download?taskId=$1" -o "$2";};wait_task(){ local id="$1" out="$2" status="";for _ in $(seq 1 240);do [[ "$(post /api/v1/content-transfers/get "{\"taskId\":\"$id\"}" "$out")" == 200 ]];status="$(val status < "$out")";[[ "$status" != PENDING && "$status" != RUNNING ]]&&break;sleep .25;done;[[ "$status" == SUCCEEDED ]];};export_page(){ local page="$1" format="$2" out="$3" code id;local task="$out-task.json";code="$(post /api/v1/content-transfers/exports/page "{\"pageId\":\"$page\",\"format\":\"$format\",\"published\":false}" "$task")";[[ "$code" == 202 ]];id="$(val id < "$task")";wait_task "$id" "$task";download "$id" "$out";}
docker network create "$net" >/dev/null;docker run -d --name "$db" --network "$net" --network-alias database -e POSTGRES_DB=knowledge -e POSTGRES_USER=knowledge -e POSTGRES_PASSWORD=knowledge postgres:17.6-alpine >/dev/null;wait_for db docker exec "$db" pg_isready -U knowledge -d knowledge
docker run -d --name "$api" --network "$net" -p 127.0.0.1::8080 --entrypoint java -e DATABASE_URL=jdbc:postgresql://database:5432/knowledge -e DATABASE_USER=knowledge -e DATABASE_PASSWORD=knowledge -e SESSION_COOKIE_SECURE=false -e SETTINGS_MASTER_KEY="$(openssl rand -base64 32)" -e COLLAB_INTERNAL_TOKEN="$internal" -v "$jar:/app.jar:ro" gradle:9.7.0-jdk25 -jar /app.jar >/dev/null;port="$(docker port "$api" 8080/tcp|sed -n 's/.*://p'|head -1)";url="http://127.0.0.1:$port";wait_for api curl -fsS "$url/actuator/health"
cookie="$tmp/c";code="$(curl -sS -o "$tmp/setup" -w '%{http_code}' -c "$cookie" -H 'Content-Type: application/json' --data-binary '{"email":"admin@example.com","password":"Admin-Password-2026!","passwordConfirmation":"Admin-Password-2026!","workspaceName":"Structured Workspace"}' "$url/api/v1/setup/initialize")";[[ "$code" == 201 ]];actor="$(val userId < "$tmp/setup")";ws="$(val workspaceId < "$tmp/setup")";csrf="$(curl -fsS -b "$cookie" "$url/api/v1/auth/csrf")";header="$(printf %s "$csrf"|val headerName)";token="$(printf %s "$csrf"|val token)"
code="$(post /api/v1/knowledge-bases/create "{\"workspaceId\":\"$ws\",\"name\":\"Structured KB\",\"slug\":\"structured-kb\",\"ownerType\":\"WORKSPACE\",\"ownerId\":\"$ws\",\"visibility\":\"PRIVATE\",\"publishMode\":\"MANUAL\"}" "$tmp/kb")";[[ "$code" == 201 ]];kb="$(val id < "$tmp/kb")"
python3 - "$tmp/payloads" <<'PY'
import json,sys,os
os.makedirs(sys.argv[1])
values={
 'WHITEBOARD':{'type':'whiteboard','viewport':{'x':0,'y':0,'zoom':1},'elements':[{'id':'shape-1','kind':'STICKY','x':10,'y':20,'width':180,'height':120,'text':'Roadmap 画板','color':'#fff1a8'}]},
 'SPREADSHEET':{'type':'workbook','activeSheetId':'sheet-1','sheets':[{'id':'sheet-1','name':'预算','rows':[['项目','金额','内部备注'],['服务器','185.99','仅内部'],['合计','=SUM(B2:B2)','']], 'styles':{'0:0':{'bold':True,'background':'#dff3e6'},'2:1':{'bold':True,'italic':True,'underline':True,'align':'RIGHT','numberFormat':'CURRENCY'}},'frozenRows':1,'frozenColumns':1,'hiddenRows':[1],'hiddenColumns':[2],'protectedCells':['1:1'],'dropdowns':{'1:0':['服务器','数据库']},'filter':'服务器'}]},
 'DATABASE':{'type':'database','fields':[{'id':'name','name':'名称','type':'TEXT'},{'id':'status','name':'状态','type':'SELECT','options':['进行中']},{'id':'price','name':'单价','type':'NUMBER'},{'id':'quantity','name':'数量','type':'NUMBER'},{'id':'total','name':'合计','type':'FORMULA','formula':'{单价} * {数量}'}],'rows':[{'id':'row-1','values':{'name':'发布计划','status':'进行中','price':120,'quantity':3},'createdAt':'2026-01-01T00:00:00Z'}],'view':'KANBAN','filter':'发布','sortFieldId':'total','activeViewId':'release-board','views':[{'id':'all-table','name':'全量表格','type':'TABLE','filter':'','sortFieldId':'name','groupFieldId':None,'visibleFieldIds':['name','status','price','quantity','total']},{'id':'release-board','name':'发布看板','type':'KANBAN','filter':'发布','sortFieldId':'total','groupFieldId':'status','visibleFieldIds':['name','status','total']}],'form':{'enabled':True,'title':'需求登记','description':'公开收集需求','submitLabel':'提交需求','successMessage':'登记成功','fieldIds':['name','status','price','quantity'],'requiredFieldIds':['name','price','quantity']}},
}
for kind,value in values.items():
 with open(f'{sys.argv[1]}/{kind}.json','w',encoding='utf-8') as f:json.dump({'knowledgeBaseId':'PLACEHOLDER','title':kind,'path':kind.lower(),'contentType':kind,'visibilityOverride':'PUBLIC' if kind=='DATABASE' else 'INHERIT','content':value},f,ensure_ascii=False)
PY
for kind in WHITEBOARD SPREADSHEET DATABASE;do python3 - "$tmp/payloads/$kind.json" "$kb" <<'PY'
import json,sys
p=json.load(open(sys.argv[1]));p['knowledgeBaseId']=sys.argv[2];json.dump(p,open(sys.argv[1],'w'),ensure_ascii=False)
PY
code="$(post /api/v1/pages/create "$(cat "$tmp/payloads/$kind.json")" "$tmp/$kind-create")";[[ "$code" == 201 ]];id="$(val id < "$tmp/$kind-create")";printf '%s' "$id" > "$tmp/$kind-id";done
python3 - "$tmp/materialize.json" "$tmp/WHITEBOARD-id" "$actor" <<'PY'
import json,sys
content={'type':'whiteboard','viewport':{'x':14,'y':8,'zoom':1.2},'elements':[{'id':'shape-2','kind':'TEXT','x':30,'y':40,'width':200,'height':60,'text':'协作物化后的画板','color':'#ffffff'}]}
json.dump({'pageId':open(sys.argv[2]).read(),'sequence':1,'actorId':sys.argv[3],'contentType':'WHITEBOARD','plainText':json.dumps(content,ensure_ascii=False)},open(sys.argv[1],'w'),ensure_ascii=False)
PY
code="$(curl -sS -o "$tmp/materialized" -w '%{http_code}' -H "X-Internal-Token: $internal" -H 'Content-Type: application/json' --data-binary "@$tmp/materialize.json" "$url/api/internal/v1/collaboration/materialize")";[[ "$code" == 200 ]];grep -q '"applied":true' "$tmp/materialized"
whiteboard="$(cat "$tmp/WHITEBOARD-id")";code="$(post /api/v1/pages/get "{\"pageId\":\"$whiteboard\"}" "$tmp/whiteboard-get")";[[ "$code" == 200 ]]
python3 - "$tmp/whiteboard-get" "$tmp/SPREADSHEET-create" "$tmp/DATABASE-create" <<'PY'
import json,sys
w,s,d=[json.load(open(path)) for path in sys.argv[1:]]
assert w['contentType']=='WHITEBOARD' and w['content']['elements'][0]['text']=='协作物化后的画板',w
assert '协作物化后的画板' in w['plainText'],w['plainText']
assert s['content']['sheets'][0]['rows'][1][1]=='185.99' and s['content']['sheets'][0]['rows'][2][1]=='=SUM(B2:B2)'
assert s['content']['sheets'][0]['frozenColumns']==1 and s['content']['sheets'][0]['hiddenRows']==[1] and s['content']['sheets'][0]['protectedCells']==['1:1']
assert '服务器' in s['plainText']
assert d['content']['view']=='KANBAN' and '发布计划' in d['plainText']
assert d['content']['activeViewId']=='release-board' and d['content']['views'][0]['filter']=='' and d['content']['views'][1]['filter']=='发布'
PY
for kind in WHITEBOARD SPREADSHEET DATABASE;do id="$(cat "$tmp/$kind-id")";code="$(post /api/v1/pages/labels/update "{\"pageId\":\"$id\",\"expectedRevision\":0,\"labels\":[{\"name\":\"统一生命周期\",\"color\":\"#5A8F6B\"},{\"name\":\"$kind\",\"color\":\"#568FC7\"}]}" "$tmp/$kind-labels")";[[ "$code" == 200 ]];[[ "$(val revision < "$tmp/$kind-labels")" == 1 ]];done
code="$(post /api/v1/pages/labels/update "{\"pageId\":\"$(cat "$tmp/DATABASE-id")\",\"expectedRevision\":0,\"labels\":[]}" "$tmp/stale-labels")";[[ "$code" == 409 ]];grep -q 'PAGE_LABEL_REVISION_CONFLICT' "$tmp/stale-labels"
code="$(post /api/v1/search "{\"workspaceId\":\"$ws\",\"query\":\"统一生命周期\",\"resourceTypes\":[\"PAGE\"],\"limit\":20}" "$tmp/label-search")";[[ "$code" == 200 ]]
python3 - "$tmp/label-search" <<'PY'
import json,sys
result=json.load(open(sys.argv[1]));assert len(result['results'])==3,result
assert {item['contentType'] for item in result['results']}=={'WHITEBOARD','SPREADSHEET','DATABASE'},result
PY
spreadsheet="$(cat "$tmp/SPREADSHEET-id")";database="$(cat "$tmp/DATABASE-id")"
code="$(post /api/v1/pages/publish "{\"pageId\":\"$database\",\"idempotencyKey\":\"first-class-label-publication\"}" "$tmp/database-publication")";[[ "$code" == 201 ]]
python3 - "$tmp/database-publication" <<'PY'
import json,sys
publication=json.load(open(sys.argv[1]));assert publication['metadata']['labels']==['统一生命周期','DATABASE'],publication
PY
publication="$(val id < "$tmp/database-publication")";form_key="public-form-$(openssl rand -hex 12)"
code="$(curl -sS -o "$tmp/form-submit" -w '%{http_code}' -H 'Content-Type: application/json' --data-binary "{\"publicationId\":\"$publication\",\"idempotencyKey\":\"$form_key\",\"values\":{\"name\":\"访客需求\",\"status\":\"进行中\",\"price\":50,\"quantity\":2}}" "$url/api/public/v1/database-forms/submit")";[[ "$code" == 201 ]];[[ "$(val duplicate < "$tmp/form-submit")" == False ]]
code="$(curl -sS -o "$tmp/form-duplicate" -w '%{http_code}' -H 'Content-Type: application/json' --data-binary "{\"publicationId\":\"$publication\",\"idempotencyKey\":\"$form_key\",\"values\":{\"name\":\"不应重复\",\"price\":1,\"quantity\":1}}" "$url/api/public/v1/database-forms/submit")";[[ "$code" == 200 ]];[[ "$(val duplicate < "$tmp/form-duplicate")" == True ]];[[ "$(val rowId < "$tmp/form-duplicate")" == "$(val rowId < "$tmp/form-submit")" ]]
code="$(curl -sS -o "$tmp/form-invalid" -w '%{http_code}' -H 'Content-Type: application/json' --data-binary "{\"publicationId\":\"$publication\",\"idempotencyKey\":\"invalid-form-$(openssl rand -hex 8)\",\"values\":{\"name\":\"缺少必填数字\"}}" "$url/api/public/v1/database-forms/submit")";[[ "$code" == 400 ]];grep -q 'is required' "$tmp/form-invalid"
code="$(post /api/v1/pages/get "{\"pageId\":\"$database\"}" "$tmp/database-after-form")";[[ "$code" == 200 ]]
python3 - "$tmp/database-after-form" <<'PY'
import json,sys
page=json.load(open(sys.argv[1]));rows=page['content']['rows'];assert len(rows)==2,rows
assert rows[1]['values']=={'name':'访客需求','status':'进行中','price':50.0,'quantity':2.0},rows[1]
assert page['draftRevision']==1,page['draftRevision']
PY
export_page "$whiteboard" PNG "$tmp/board.png"
export_page "$whiteboard" SVG "$tmp/board.svg"
export_page "$spreadsheet" XLSX "$tmp/workbook.xlsx"
export_page "$database" CSV "$tmp/database.csv"
export_page "$database" XLSX "$tmp/database.xlsx"
code="$(post /api/v1/content-transfers/exports/page "{\"pageId\":\"$database\",\"format\":\"PDF\",\"published\":false}" "$tmp/database-pdf")";[[ "$code" == 400 ]];grep -q 'unsupported' "$tmp/database-pdf"
python3 - "$tmp/board.png" "$tmp/board.svg" "$tmp/workbook.xlsx" "$tmp/database.csv" "$tmp/database.xlsx" <<'PY'
import csv,io,re,struct,sys,zipfile
png,svg,xlsx,csv_path,database_xlsx=sys.argv[1:]
raw=open(png,'rb').read();assert raw[:8]==b'\x89PNG\r\n\x1a\n';width,height=struct.unpack('>II',raw[16:24]);assert width>=128 and height>=128,(width,height)
svg_text=open(svg,encoding='utf-8').read();assert '<svg' in svg_text and '协作物化后的画板' in svg_text and '<text' in svg_text
with zipfile.ZipFile(xlsx) as book:
 xml=b'\n'.join(book.read(name) for name in book.namelist() if name.endswith('.xml'))
 assert b'<f>SUM(B2:B2)</f>' in xml,xml[:500]
 assert b'<pane' in xml and b'frozen' in xml
 assert b'xSplit="1.0"' in xml and b'ySplit="1.0"' in xml
 assert b'hidden="true"' in xml and b'<dataValidations' in xml and b'<sheetProtection' in xml
 assert '服务器'.encode() in xml
rows=list(csv.reader(io.StringIO(open(csv_path,encoding='utf-8-sig').read())))
assert rows[0]==['名称','状态','单价','数量','合计'],rows
assert rows[1]==['发布计划','进行中','120','3','360'],rows
assert rows[2]==['访客需求','进行中','50','2','100'],rows
with zipfile.ZipFile(database_xlsx) as book:
 sheet=book.read('xl/worksheets/sheet1.xml')
 assert re.search(br'<c r="E2"[^>]*><v>360(?:\.0)?</v></c>',sheet),sheet
 assert re.search(br'<c r="E3"[^>]*><v>100(?:\.0)?</v></c>',sheet),sheet
PY
code="$(post /api/v1/pages/unpublish "{\"pageId\":\"$database\"}" "$tmp/database-unpublish")";[[ "$code" == 204 ]]
code="$(curl -sS -o "$tmp/form-after-unpublish" -w '%{http_code}' -H 'Content-Type: application/json' --data-binary "{\"publicationId\":\"$publication\",\"idempotencyKey\":\"after-unpublish-$(openssl rand -hex 8)\",\"values\":{\"name\":\"不应写入\",\"price\":1,\"quantity\":1}}" "$url/api/public/v1/database-forms/submit")";[[ "$code" == 404 ]]
echo FIRST_CLASS_CONTENT_E2E_COUNTS;docker exec "$db" psql -U knowledge -d knowledge -Atc "select p.content_type,count(*),count(*) filter(where d.plain_text<>'') from pages p join page_drafts d on d.page_id=p.id where p.knowledge_base_id='$kb' group by p.content_type order by p.content_type;select count(*),count(*) filter(where status='SUCCEEDED'),count(*) filter(where task_type='EXPORT') from content_transfer_tasks;select count(*),count(distinct page_id),count(*) filter(where name='统一生命周期') from page_labels";echo FIRST_CLASS_CONTENT_E2E_SUCCESS
