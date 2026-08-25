#!/usr/bin/env bash
set -Eeuo pipefail
trap 'echo "Content transfer E2E failed at line $LINENO" >&2' ERR
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.."&&pwd)";jar="${API_JAR:-$root/backend/app-api/build/libs/knowledge-platform-api.jar}";[[ -f "$jar" ]];suffix="kp-io-e2e-$(date +%s)-$$";net="$suffix-net";db="$suffix-db";api="$suffix-api";tmp="$(mktemp -d /tmp/kp-io-e2e.XXXXXX)"
cleanup(){ docker rm -f "$api" "$db" >/dev/null 2>&1||true;docker network rm "$net" >/dev/null 2>&1||true;case "$tmp" in /tmp/kp-io-e2e.*)rm -rf -- "$tmp";;esac;};trap cleanup EXIT
wait_for(){ local l="$1";shift;for _ in $(seq 1 90);do "$@" >/dev/null 2>&1&&return;sleep 1;done;echo "timeout $l";docker logs "$api";return 1;};val(){ python3 -c 'import json,sys;print(json.load(sys.stdin)[sys.argv[1]])' "$1";};post(){ local p="$1" d="$2" o="$3";curl -sS -o "$o" -w '%{http_code}' -b "$cookie" -H "$header: $token" -H 'Content-Type: application/json' --data-binary "$d" "$url$p";};download(){ curl -fsS -b "$cookie" "$url/api/v1/content-transfers/download?taskId=$1" -o "$2";};wait_task(){ local id="$1" out="$2" status="";for _ in $(seq 1 240);do [[ "$(post /api/v1/content-transfers/get "{\"taskId\":\"$id\"}" "$out")" == 200 ]];status="$(val status < "$out")";[[ "$status" != PENDING && "$status" != RUNNING ]]&&break;sleep .25;done;[[ "$status" == SUCCEEDED || "$status" == FAILED || "$status" == CANCELLED ]];}
docker network create "$net" >/dev/null;docker run -d --name "$db" --network "$net" --network-alias database -e POSTGRES_DB=knowledge -e POSTGRES_USER=knowledge -e POSTGRES_PASSWORD=knowledge postgres:17.6-alpine >/dev/null;wait_for db docker exec "$db" pg_isready -U knowledge -d knowledge
docker run -d --name "$api" --network "$net" -p 127.0.0.1::8080 --entrypoint java -e DATABASE_URL=jdbc:postgresql://database:5432/knowledge -e DATABASE_USER=knowledge -e DATABASE_PASSWORD=knowledge -e SESSION_COOKIE_SECURE=false -e SETTINGS_MASTER_KEY="$(openssl rand -base64 32)" -v "$jar:/app.jar:ro" gradle:9.7.0-jdk25 -jar /app.jar >/dev/null;port="$(docker port "$api" 8080/tcp|sed -n 's/.*://p'|head -1)";url="http://127.0.0.1:$port";wait_for api curl -fsS "$url/actuator/health"
cookie="$tmp/c";code="$(curl -sS -o "$tmp/setup" -w '%{http_code}' -c "$cookie" -H 'Content-Type: application/json' --data-binary '{"email":"admin@example.com","password":"Admin-Password-2026!","passwordConfirmation":"Admin-Password-2026!","workspaceName":"IO Workspace"}' "$url/api/v1/setup/initialize")";[[ "$code" == 201 ]];admin="$(val userId < "$tmp/setup")";ws="$(val workspaceId < "$tmp/setup")";csrf="$(curl -fsS -b "$cookie" "$url/api/v1/auth/csrf")";header="$(printf %s "$csrf"|val headerName)";token="$(printf %s "$csrf"|val token)"
code="$(post /api/v1/knowledge-bases/create "{\"workspaceId\":\"$ws\",\"name\":\"Transfer KB\",\"slug\":\"transfer-kb\",\"ownerType\":\"WORKSPACE\",\"ownerId\":\"$ws\",\"visibility\":\"PRIVATE\",\"publishMode\":\"MANUAL\"}" "$tmp/kb")";[[ "$code" == 201 ]];kb="$(val id < "$tmp/kb")"
cancel_task="$(python3 -c 'import uuid;print(uuid.uuid4())')"
docker exec "$db" psql -U knowledge -d knowledge -v ON_ERROR_STOP=1 -c "insert into content_transfer_tasks(id,workspace_id,task_type,source_format,resource_type,resource_id,status,progress,original_filename,report,requested_by,created_at) values ('$cancel_task','$ws','IMPORT','MARKDOWN','KNOWLEDGE_BASE','$kb','PENDING',0,'queued-cancel.md','{}'::jsonb,'$admin',now());insert into content_transfer_payloads(task_id,payload,created_at) values ('$cancel_task',decode('232063616e63656c','hex'),now());" >/dev/null
code="$(post /api/v1/content-transfers/cancel "{\"taskId\":\"$cancel_task\"}" "$tmp/cancelled")"
if [[ "$code" != 200 ]];then echo "cancel HTTP $code" >&2;cat "$tmp/cancelled" >&2;exit 1;fi
if [[ "$(val status < "$tmp/cancelled")" != CANCELLED ]];then echo 'pending task was not cancelled' >&2;cat "$tmp/cancelled" >&2;exit 1;fi
if [[ "$(val cancelRequested < "$tmp/cancelled")" != False ]];then echo 'completed cancellation still looks pending' >&2;cat "$tmp/cancelled" >&2;exit 1;fi
if [[ "$(python3 -c 'import json,sys;print(json.load(sys.stdin)["report"]["cancelled"])' < "$tmp/cancelled")" != True ]];then echo 'cancellation report is missing' >&2;cat "$tmp/cancelled" >&2;exit 1;fi
[[ "$(docker exec "$db" psql -U knowledge -d knowledge -Atc "select count(*) from content_transfer_payloads where task_id='$cancel_task'")" == 0 ]]
code="$(post /api/v1/content-transfers/cancel "{\"taskId\":\"$cancel_task\"}" "$tmp/cancelled-again")";[[ "$code" == 200 ]];[[ "$(val status < "$tmp/cancelled-again")" == CANCELLED ]]
code="$(post /api/v1/knowledge-bases/update "{\"knowledgeBaseId\":\"$kb\",\"name\":\"Transfer KB\",\"slug\":\"transfer-kb\",\"visibility\":\"PRIVATE\",\"allowPublicIndex\":false,\"publishMode\":\"MANUAL\",\"watermarkConfig\":\"{\\\"enabled\\\":true,\\\"text\\\":\\\"CONFIDENTIAL {{email}}\\\",\\\"position\\\":\\\"TILED\\\",\\\"opacity\\\":0.16}\",\"appearanceConfig\":\"{}\",\"catalogConfig\":\"{}\"}" "$tmp/kb-update")";[[ "$code" == 200 ]]
columns_token="$(python3 -c 'import base64,json,uuid;d={"count":2,"columns":[{"content":"Left export column"},{"content":"Right export column"}],"ratios":[1,2]};e=base64.urlsafe_b64encode(json.dumps(d,separators=(",",":" )).encode()).decode().rstrip("=");print(f"{{{{card:columns|id={uuid.uuid4()}|v=1|data={e}}}}}")')"
table_token="$(python3 -c 'import base64,json,uuid;d={"rows":[["Name","Status"],["Homepage","Done"]]};e=base64.urlsafe_b64encode(json.dumps(d,separators=(",",":")).encode()).decode().rstrip("=");print(f"{{{{card:table|id={uuid.uuid4()}|v=1|data={e}}}}}")')"
sensitive_token="$(python3 -c 'import base64,json,uuid;d={"ciphertext":"AAAAAAAAAAAAAAAAAAAAAAA","salt":"AAAAAAAAAAAAAAAAAAAAAA","iv":"AAAAAAAAAAAAAAAA","kdf":"PBKDF2-SHA256","iterations":210000,"hint":"Owner only"};e=base64.urlsafe_b64encode(json.dumps(d,separators=(",",":")).encode()).decode().rstrip("=");print(f"{{{{card:sensitive-text|id={uuid.uuid4()}|v=1|data={e}}}}}")')"
code="$(post /api/v1/pages/create "{\"knowledgeBaseId\":\"$kb\",\"title\":\"Export Source\",\"path\":\"export-source\",\"contentType\":\"DOCUMENT\",\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"text\":\"Hello transfer pipeline $columns_token $table_token $sensitive_token\"}]}}" "$tmp/page")";[[ "$code" == 201 ]];page="$(val id < "$tmp/page")"

for format in MARKDOWN HTML DOCX PDF JPG;do lower="$(printf %s "$format"|tr A-Z a-z)";code="$(post /api/v1/content-transfers/exports/page "{\"pageId\":\"$page\",\"format\":\"$format\",\"published\":false}" "$tmp/$lower-task")";[[ "$code" == 202 ]];id="$(val id < "$tmp/$lower-task")";wait_task "$id" "$tmp/$lower-task";[[ "$(val status < "$tmp/$lower-task")" == SUCCEEDED ]];[[ "$(python3 -c 'import json,sys;print(json.load(sys.stdin)["report"]["watermarkApplied"])' < "$tmp/$lower-task")" == True ]];download "$id" "$tmp/source.$lower";done
code="$(post /api/v1/content-transfers/cancel "{\"taskId\":\"$id\"}" "$tmp/completed-cancel")";[[ "$code" == 409 ]];grep -q 'CONTENT_TRANSFER_NOT_CANCELLABLE' "$tmp/completed-cancel"
code="$(post /api/v1/content-transfers/exports/page "{\"pageId\":\"$page\",\"format\":\"XLSX\",\"published\":false}" "$tmp/document-xlsx")";[[ "$code" == 400 ]];grep -q 'unsupported' "$tmp/document-xlsx"
python3 - "$tmp/source.markdown" "$tmp/source.html" "$tmp/source.docx" "$tmp/source.pdf" "$tmp/source.jpg" <<'PY'
import sys,zipfile
assert b'Hello transfer pipeline' in open(sys.argv[1],'rb').read()
markdown=open(sys.argv[1],'rb').read();assert b'Left export column' in markdown and b'Right export column' in markdown and b'| Name | Status |' in markdown and b'Homepage' in markdown and b'Owner only' in markdown and b'AAAAAAAAAAAAAAAAAAAAAAA' not in markdown and b'{{card:' not in markdown
assert b'CONFIDENTIAL admin@example.com' in markdown
assert b'<!doctype html>' in open(sys.argv[2],'rb').read()
html=open(sys.argv[2],'rb').read();assert b'Left export column' in html and b'Right export column' in html and b'Name' in html and b'Homepage' in html and b'AAAAAAAAAAAAAAAAAAAAAAA' not in html and b'{{card:' not in html
assert b'CONFIDENTIAL admin@example.com' in html
assert open(sys.argv[3],'rb').read(2)==b'PK'
assert open(sys.argv[4],'rb').read(4)==b'%PDF'
assert open(sys.argv[5],'rb').read(2)==b'\xff\xd8'
for path in (sys.argv[3],):
 with zipfile.ZipFile(path) as z:assert b'CONFIDENTIAL admin@example.com' in b''.join(z.read(name) for name in z.namelist() if name.endswith('.xml'))
PY

python3 - "$tmp/source.xlsx" <<'PY'
import sys,zipfile
parts={
'[Content_Types].xml':'''<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>''',
'_rels/.rels':'''<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>''',
'xl/workbook.xml':'''<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Import" sheetId="1" r:id="rId1"/></sheets></workbook>''',
'xl/_rels/workbook.xml.rels':'''<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>''',
'xl/worksheets/sheet1.xml':'''<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Imported XLSX</t></is></c><c r="B1"><v>2026</v></c></row></sheetData></worksheet>''',
}
with zipfile.ZipFile(sys.argv[1],'w',zipfile.ZIP_DEFLATED) as book:
 for name,value in parts.items():book.writestr(name,value)
PY

printf '# Imported\n\n中文 Markdown body' > "$tmp/import.md"
code="$(curl -sS -o "$tmp/md-import" -w '%{http_code}' -b "$cookie" -H "$header: $token" -F "knowledgeBaseId=$kb" -F 'format=MARKDOWN' -F "file=@$tmp/import.md;type=text/markdown" "$url/api/v1/content-transfers/imports/upload")";[[ "$code" == 202 ]];mid="$(val id < "$tmp/md-import")";wait_task "$mid" "$tmp/md-import";[[ "$(val status < "$tmp/md-import")" == SUCCEEDED ]]
for ext in docx xlsx;do upper="$(printf %s "$ext"|tr a-z A-Z)";code="$(curl -sS -o "$tmp/$ext-import" -w '%{http_code}' -b "$cookie" -H "$header: $token" -F "knowledgeBaseId=$kb" -F "format=$upper" -F "file=@$tmp/source.$ext" "$url/api/v1/content-transfers/imports/upload")";id="$(val id < "$tmp/$ext-import")";[[ "$code" == 202 ]]&&wait_task "$id" "$tmp/$ext-import";if [[ "$(val status < "$tmp/$ext-import")" != SUCCEEDED ]];then echo "$ext import HTTP $code" >&2;cat "$tmp/$ext-import" >&2;docker logs "$api" 2>&1|grep -E -B8 -A18 'DataAccessException|PSQLException|ERROR:|violates|constraint|UnexpectedRollback'|tail -160 >&2;exit 1;fi;done
python3 - "$tmp/safe.zip" "$tmp/evil.zip" "$tmp/notion.zip" "$tmp/confluence.zip" <<'PY'
import sys,zipfile
with zipfile.ZipFile(sys.argv[1],'w') as z:z.writestr('docs/one.md','# One');z.writestr('docs/two.html','<h1>Two</h1>')
with zipfile.ZipFile(sys.argv[2],'w') as z:z.writestr('../escape.md','escape')
with zipfile.ZipFile(sys.argv[3],'w') as z:z.writestr('Notion Page.md','# Notion Page\n\nnotion migration body');z.writestr('Projects.csv','Name,Status\nMigration,Done')
with zipfile.ZipFile(sys.argv[4],'w') as z:z.writestr('entities.xml','<hibernate-generic><object class="Page"><property name="title"><![CDATA[Confluence Page]]></property><property name="body"><![CDATA[<p>confluence migration body</p>]]></property></object></hibernate-generic>')
PY
code="$(curl -sS -o "$tmp/zip-import" -w '%{http_code}' -b "$cookie" -H "$header: $token" -F "knowledgeBaseId=$kb" -F 'format=ZIP' -F "file=@$tmp/safe.zip" "$url/api/v1/content-transfers/imports/upload")";[[ "$code" == 202 ]];zid="$(val id < "$tmp/zip-import")";wait_task "$zid" "$tmp/zip-import";[[ "$(val status < "$tmp/zip-import")" == SUCCEEDED ]];[[ "$(python3 -c 'import json,sys;print(json.load(sys.stdin)["report"]["importedCount"])' < "$tmp/zip-import")" == 2 ]]
code="$(curl -sS -o "$tmp/evil-import" -w '%{http_code}' -b "$cookie" -H "$header: $token" -F "knowledgeBaseId=$kb" -F 'format=ZIP' -F "file=@$tmp/evil.zip" "$url/api/v1/content-transfers/imports/upload")";[[ "$code" == 202 ]];eid="$(val id < "$tmp/evil-import")";wait_task "$eid" "$tmp/evil-import";[[ "$(val status < "$tmp/evil-import")" == FAILED ]];grep -q 'unsafe path' "$tmp/evil-import"
for source in notion confluence;do upper="$(printf %s "$source"|tr a-z A-Z)";code="$(curl -sS -o "$tmp/$source-import" -w '%{http_code}' -b "$cookie" -H "$header: $token" -F "knowledgeBaseId=$kb" -F "format=$upper" -F "file=@$tmp/$source.zip" "$url/api/v1/content-transfers/imports/upload")";[[ "$code" == 202 ]];sid="$(val id < "$tmp/$source-import")";wait_task "$sid" "$tmp/$source-import";[[ "$(val status < "$tmp/$source-import")" == SUCCEEDED ]];done

code="$(post /api/v1/content-transfers/exports/knowledge-base "{\"knowledgeBaseId\":\"$kb\"}" "$tmp/kb-export")";[[ "$code" == 202 ]];kid="$(val id < "$tmp/kb-export")";wait_task "$kid" "$tmp/kb-export";[[ "$(val status < "$tmp/kb-export")" == SUCCEEDED ]];download "$kid" "$tmp/kb.zip";python3 - "$tmp/kb.zip" <<'PY'
import sys,zipfile,json
with zipfile.ZipFile(sys.argv[1]) as z:
 names=z.namelist();assert 'manifest.json' in names;manifest=json.loads(z.read('manifest.json'));assert manifest['pageCount']==9,manifest
 assert manifest['watermarkApplied'] is True,manifest
 assert len([n for n in names if n.endswith('.md')])==9,names
 assert all(b'{{card:' not in z.read(n) for n in names if n.endswith('.md'))
 assert all(b'CONFIDENTIAL admin@example.com' in z.read(n) for n in names if n.endswith('.md'))
PY
task_total="$(docker exec "$db" psql -U knowledge -d knowledge -Atc "select count(*) from content_transfer_tasks where requested_by='$admin'")"
task_page_limit="$((task_total-1))"
[[ "$(post /api/v1/content-transfers/page "{\"limit\":$task_page_limit,\"offset\":0}" "$tmp/task-page-one")" == 200 ]];task_next="$(val nextOffset < "$tmp/task-page-one")"
[[ "$(post /api/v1/content-transfers/page "{\"limit\":$task_page_limit,\"offset\":$task_next}" "$tmp/task-page-two")" == 200 ]]
docker exec "$db" psql -U knowledge -d knowledge -Atc "select id from content_transfer_tasks where requested_by='$admin' order by id" > "$tmp/task-ids"
python3 - "$tmp/task-page-one" "$tmp/task-page-two" "$tmp/task-ids" "$task_total" <<'PY'
import json,sys
one,two=json.load(open(sys.argv[1])),json.load(open(sys.argv[2])); expected={line.strip() for line in open(sys.argv[3]) if line.strip()}; total=int(sys.argv[4])
assert len(one['items'])==total-1 and one['hasMore'] is True and one['nextOffset']==total-1,one
assert len(two['items'])==1 and two['hasMore'] is False and two['nextOffset']==total,two
actual={item['id'] for item in one['items']+two['items']}
assert actual==expected and len(actual)==total,(actual,expected)
PY
echo CONTENT_TRANSFER_E2E_COUNTS;docker exec "$db" psql -U knowledge -d knowledge -Atc "select count(*),count(*) filter(where task_type='IMPORT'),count(*) filter(where task_type='EXPORT'),count(*) filter(where status='FAILED'),(select count(*) from pages where knowledge_base_id='$kb' and deleted_at is null) from content_transfer_tasks";echo CONTENT_TRANSFER_E2E_SUCCESS
