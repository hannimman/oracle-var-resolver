/* Oracle 식 평가기 + 변수 파서 + 치환 (DOM 없음 — 브라우저/Node 공용)
   지원 함수: TO_DATE, TO_CHAR, LAST_DAY, ADD_MONTHS, SUBSTR, REPLACE
   지원 연산: 날짜 ± 정수(일), 문자열 || 연결 */
const FUNCS = new Set(['TO_DATE','TO_CHAR','LAST_DAY','ADD_MONTHS','SUBSTR','REPLACE','TO_NUMBER','NVL','COALESCE','TO_TIMESTAMP']);
const DATEFMT = 'YYYY-MM-DD HH24:MI:SS';

function tokenize(s){
  const t=[]; let i=0;
  while(i<s.length){
    const c=s[i];
    if(/\s/.test(c)){i++;continue;}
    if(c==="'"){let j=i+1,str="";while(j<s.length){if(s[j]==="'"){if(s[j+1]==="'"){str+="'";j+=2;continue;}j++;break;}str+=s[j++];}t.push({k:'str',v:str});i=j;continue;}
    if(/[0-9]/.test(c)){let j=i;while(j<s.length&&/[0-9]/.test(s[j]))j++;t.push({k:'num',v:parseInt(s.slice(i,j),10)});i=j;continue;}
    if(/[A-Za-z_$]/.test(c)){let j=i;while(j<s.length&&/[A-Za-z0-9_$]/.test(s[j]))j++;t.push({k:'id',v:s.slice(i,j)});i=j;continue;}
    if(c==='|'&&s[i+1]==='|'){t.push({k:'op',v:'||'});i+=2;continue;}
    if('()+-,'.includes(c)){t.push({k:'op',v:c});i++;continue;}
    throw new Error('알 수 없는 문자: '+c);
  }
  return t;
}

function mkDate(y,mo,d,h,mi,s){return new Date(Date.UTC(y,mo-1,d,h||0,mi||0,s||0));}
function pad(n,w){return String(n).padStart(w,'0');}
function lastDayOfMonth(y,mo){return new Date(Date.UTC(y,mo,0)).getUTCDate();}

// 포맷 생략된 TO_DATE(str) 용 추론 (Oracle NLS 기본값 대용)
function inferFmt(s){
  if(/^\d{8}$/.test(s))return 'YYYYMMDD';
  if(/^\d{6}$/.test(s))return 'YYYYMM';
  if(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s))return 'YYYY-MM-DD HH24:MI:SS';
  if(/^\d{4}-\d{2}-\d{2}$/.test(s))return 'YYYY-MM-DD';
  throw new Error('TO_DATE 포맷 추론 실패(2번째 인자로 명시 필요): '+s);
}
function toDate(str,fmt){
  fmt=fmt.toUpperCase(); // 마스크 대소문자 무시 (yyyy-MM-dd 등)
  const map={YYYY:'(\\d{4})',HH24:'(\\d{2})',MM:'(\\d{2})',DD:'(\\d{2})',MI:'(\\d{2})',SS:'(\\d{2})'};
  let re='',i=0;const order=[];
  while(i<fmt.length){
    let m=false;
    for(const tok of ['YYYY','HH24','MM','DD','MI','SS']){if(fmt.startsWith(tok,i)){re+=map[tok];order.push(tok);i+=tok.length;m=true;break;}}
    if(!m){re+='[^0-9]?';i++;} // 구분자는 있어도/없어도 매칭 (Oracle TO_DATE는 관대함)
  }
  const g=new RegExp('^'+re+'$').exec(str);
  if(!g)throw new Error('TO_DATE 파싱 실패: "'+str+'" / "'+fmt+'"');
  const o={};order.forEach((tok,idx)=>o[tok]=parseInt(g[idx+1],10));
  return mkDate(o.YYYY,o.MM||1,o.DD||1,o.HH24,o.MI,o.SS);
}
function toChar(d,fmt){
  fmt=fmt.toUpperCase(); // 마스크 대소문자 무시
  const v={YYYY:pad(d.getUTCFullYear(),4),HH24:pad(d.getUTCHours(),2),MM:pad(d.getUTCMonth()+1,2),DD:pad(d.getUTCDate(),2),MI:pad(d.getUTCMinutes(),2),SS:pad(d.getUTCSeconds(),2)};
  let out='',i=0;
  while(i<fmt.length){
    let m=false;
    for(const tok of ['YYYY','HH24','MM','DD','MI','SS']){if(fmt.startsWith(tok,i)){out+=v[tok];i+=tok.length;m=true;break;}}
    if(!m){out+=fmt[i];i++;}
  }
  return out;
}
function lastDay(d){return mkDate(d.getUTCFullYear(),d.getUTCMonth()+1,lastDayOfMonth(d.getUTCFullYear(),d.getUTCMonth()+1),d.getUTCHours(),d.getUTCMinutes(),d.getUTCSeconds());}
function addMonths(d,n){
  const total=d.getUTCFullYear()*12+d.getUTCMonth()+n;
  const y=Math.floor(total/12),mo=(total%12)+1;
  // ponytail: 입력일이 말일일 때 결과를 말일로 고정하는 Oracle 특례는 생략. 필요하면 추가.
  const day=Math.min(d.getUTCDate(),lastDayOfMonth(y,mo));
  return mkDate(y,mo,day,d.getUTCHours(),d.getUTCMinutes(),d.getUTCSeconds());
}
function addDays(d,n){return new Date(d.getTime()+n*86400000);}

function asStr(v){if(v.t==='str')return v.v;if(v.t==='num')return String(v.v);return toChar(v.v,DATEFMT);}
// 날짜 함수에 문자열이 오면 Oracle처럼 암묵적 날짜 변환
function asDate(v){if(v.t==='date')return v.v;if(v.t==='str')return toDate(v.v,inferFmt(v.v));throw new Error('날짜로 변환 불가');}

function callFunc(name,a){
  switch(name){
    case 'TO_DATE': case 'TO_TIMESTAMP': return {t:'date',v:toDate(asStr(a[0]),a.length>1?asStr(a[1]):inferFmt(asStr(a[0])))};
    case 'TO_CHAR': return {t:'str', v:toChar(asDate(a[0]),asStr(a[1]))};
    case 'LAST_DAY':return {t:'date',v:lastDay(asDate(a[0]))};
    case 'ADD_MONTHS':return {t:'date',v:addMonths(asDate(a[0]),a[1].v)};
    case 'TO_NUMBER':return {t:'num',v:Number(asStr(a[0]))};
    case 'NVL':return (a[0].t==='str'&&a[0].v==='')?a[1]:a[0]; // 빈 문자열(=NULL)이면 두번째 값
    case 'COALESCE':return a.find(x=>!(x.t==='str'&&x.v===''))||a[a.length-1];
    case 'SUBSTR':{const s=asStr(a[0]),st=a[1].v,ln=a.length>2?a[2].v:undefined;const b=st>0?st-1:s.length+st;return {t:'str',v:ln===undefined?s.slice(b):s.substr(b,ln)};}
    case 'REPLACE':{const s=asStr(a[0]),f=asStr(a[1]),r=a.length>2?asStr(a[2]):'';return {t:'str',v:f===''?s:s.split(f).join(r)};}
    default: throw new Error('지원하지 않는 함수: '+name);
  }
}

function evalExpr(expr,env){
  const toks=tokenize(expr); let p=0;
  const peek=()=>toks[p], eat=()=>toks[p++];
  function concat(){let l=additive();while(peek()&&peek().k==='op'&&peek().v==='||'){eat();l={t:'str',v:asStr(l)+asStr(additive())};}return l;}
  function additive(){let l=factor();while(peek()&&peek().k==='op'&&(peek().v==='+'||peek().v==='-')){const op=eat().v;const r=factor();l=applyAdd(l,r,op==='+'?1:-1);}return l;}
  function applyAdd(a,b,sign){
    if(a.t==='date'&&b.t==='num')return {t:'date',v:addDays(a.v,sign*b.v)};
    if(a.t==='num'&&b.t==='num')return {t:'num',v:a.v+sign*b.v};
    throw new Error('지원하지 않는 산술');
  }
  function factor(){
    const t=peek();
    if(!t)throw new Error('식이 비었음');
    if(t.k==='op'&&(t.v==='-'||t.v==='+')){eat();const f=factor();return {t:'num',v:(t.v==='-'?-1:1)*f.v};}
    if(t.k==='op'&&t.v==='('){eat();const e=concat();if(!peek()||peek().v!==')')throw new Error("')' 누락");eat();return e;}
    if(t.k==='num'){eat();return {t:'num',v:t.v};}
    if(t.k==='str'){eat();return {t:'str',v:t.v};}
    if(t.k==='id'){
      eat();
      if(peek()&&peek().k==='op'&&peek().v==='('){ // function call
        eat();const args=[];
        if(!(peek()&&peek().v===')')){args.push(concat());while(peek()&&peek().v===','){eat();args.push(concat());}}
        if(!peek()||peek().v!==')')throw new Error("')' 누락");eat();
        return callFunc(t.v.toUpperCase(),args);
      }
      if(!(t.v in env))throw new Error('미정의 변수: '+t.v);
      return env[t.v];
    }
    throw new Error('예상치 못한 토큰: '+JSON.stringify(t));
  }
  const r=concat();
  if(p<toks.length)throw new Error('남은 토큰: '+JSON.stringify(toks[p]));
  return r;
}

function literalOf(v){
  if(v.t==='str')return "'"+v.v.replace(/'/g,"''")+"'";
  if(v.t==='num')return String(v.v);
  // 시각이 00:00:00이면 날짜만, 시간이 있으면(23:59:59 등) 시간까지 출력
  const hasTime=v.v.getUTCHours()||v.v.getUTCMinutes()||v.v.getUTCSeconds();
  const f=hasTime?DATEFMT:'YYYY-MM-DD';
  return "TO_DATE('"+toChar(v.v,f)+"','"+f+"')";
}

/* ---------- 초기화 블록 파싱 ---------- */
// 최상위(괄호 밖, 문자열 밖) 콤마로만 분리. 함수 인자 안의 콤마는 무시.
function splitTopLevel(s){
  const out=[];let depth=0,cur='',q=false;
  for(let i=0;i<s.length;i++){
    const c=s[i];
    if(q){cur+=c;if(c==="'"){if(s[i+1]==="'"){cur+="'";i++;}else q=false;}continue;}
    if(c==="'"){q=true;cur+=c;continue;}
    if(c==='(')depth++;else if(c===')')depth--;
    if(c===','&&depth===0){out.push(cur);cur='';continue;}
    cur+=c;
  }
  out.push(cur);
  return out.map(x=>x.trim()).filter(Boolean);
}
function parseInit(text){
  const noBlock=text.replace(/\/\*[\s\S]*?\*\//g,''); // 블록주석 /* */ 제거
  const clean=noBlock.split('\n').map(l=>{const i=l.indexOf('--');return i>=0?l.slice(0,i):l;}).join('\n'); // 줄주석 -- 제거
  return clean.split(';').map(s=>s.trim()).filter(Boolean).flatMap(st=>{
    let m=/^([A-Za-z_$][\w$]*)\s*:=\s*([\s\S]+)$/.exec(st);            // VAR := EXPR
    if(m)return [{name:m[1],expr:m[2].trim()}];
    m=/^SELECT\s+([\s\S]+?)\s+INTO\s+([\s\S]+?)\s+FROM\s+DUAL\b/i.exec(st); // SELECT 식들 INTO 변수들 FROM DUAL → 계산가능
    if(m){
      const e=splitTopLevel(m[1]), v=splitTopLevel(m[2]);
      if(e.length===v.length) return v.map((nm,i)=>({name:nm,expr:e[i]}));
      return e.length&&v.length?[{name:v[0],expr:e[0]}]:[]; // 개수 안 맞으면 첫 쌍만
    }
    m=/^SELECT\s+[\s\S]+?\s+INTO\s+([\s\S]+?)\s+FROM\b/i.exec(st);      // SELECT ... INTO 변수들 FROM 테이블 → 계산불가(수동)
    if(m)return splitTopLevel(m[1]).map(nm=>({name:nm,expr:null}));
    return [];
  });
}
// 쿼리에서 변수 후보 추출: P_/V_/p_ 로 시작하는 식별자 (컬럼 ALIAS.COL 은 제외). 대소문자 구분 없이 중복 제거.
function scanVars(text){
  const seen=new Set(),out=[]; const re=/(?<![\w.$])[PpVv]_[A-Za-z0-9_]+/g; let m;
  while((m=re.exec(text))){const k=m[0].toLowerCase();if(!seen.has(k)){seen.add(k);out.push(m[0]);}}
  return out;
}
function freeVars(assigns){
  const assigned=new Set(assigns.map(a=>a.name)), free=new Set();
  for(const a of assigns){
    if(!a.expr)continue;
    const toks=tokenize(a.expr);
    for(let i=0;i<toks.length;i++){
      const t=toks[i];
      if(t.k==='id'){
        const call=toks[i+1]&&toks[i+1].k==='op'&&toks[i+1].v==='(';
        if(!call&&!assigned.has(t.v)&&!FUNCS.has(t.v.toUpperCase()))free.add(t.v);
      }
    }
  }
  return [...free];
}

/* ---------- 치환 ---------- */
function substitute(query,vars){
  let out=query;
  for(const {name,literal} of [...vars].sort((a,b)=>b.name.length-a.name.length)){
    const re=new RegExp('(?<![\\w$])'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?![\\w$])','gi'); // 대소문자 무시(Oracle 식별자)
    out=out.replace(re,()=>literal); // 함수 replacer로 $ 특수처리 회피
  }
  return out;
}

// 입력 버릇: '202606' 처럼 따옴표째 넣어도 받아주도록 양끝 작은따옴표 한 쌍 제거
function unq(s){s=(s||'').trim();return s.length>=2&&s[0]==="'"&&s.endsWith("'")?s.slice(1,-1):s;}

// Node(테스트)에서 require 할 수 있게. 브라우저에선 module 이 없으므로 건너뜀.
if(typeof module!=='undefined') module.exports={evalExpr,literalOf,parseInit,scanVars,freeVars,substitute,unq};
