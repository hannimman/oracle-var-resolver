/* 동적 SQL 조립 (V_SQL := V_SQL || '...' + IF/ELSIF/ELSE 분기 + 변수 삽입)
   - 루프(FOR/LOOP)는 지원 안 함 → 해당 구간은 건너뜀
   - 문자열 || 연결과 변수 삽입 계산은 app.js 의 evalExpr 재사용
   기존 코드(app.js/index.html)와 독립. 삭제해도 기존 기능 영향 없음. */

function _evalExpr(){ // 브라우저: window.evalExpr, Node: require
  return (typeof window!=='undefined'&&window.evalExpr)?window.evalExpr:require('./app.js').evalExpr;
}

// 문자열/주석 인식하며 -- 와 /* */ 제거
function stripComments(src){
  let out='',i=0;const n=src.length;
  while(i<n){
    const c=src[i];
    if(c==="'"){let j=i+1;while(j<n){if(src[j]==="'"){if(src[j+1]==="'"){j+=2;continue;}j++;break;}j++;}out+=src.slice(i,j);i=j;continue;}
    if(c==='-'&&src[i+1]==='-'){while(i<n&&src[i]!=='\n')i++;continue;}
    if(c==='/'&&src[i+1]==='*'){i+=2;while(i<n&&!(src[i]==='*'&&src[i+1]==='/'))i++;i+=2;continue;}
    out+=c;i++;
  }
  return out;
}

// 구조 토큰화 (오프셋 포함). 문자열은 통째로 한 토큰.
function lex(src){
  const t=[];let i=0;const n=src.length;
  while(i<n){
    const c=src[i];
    if(/\s/.test(c)){i++;continue;}
    if(c==="'"){let j=i+1;while(j<n){if(src[j]==="'"){if(src[j+1]==="'"){j+=2;continue;}j++;break;}j++;}t.push({k:'str',v:src.slice(i,j),s:i,e:j});i=j;continue;}
    if(/[0-9]/.test(c)){let j=i;while(j<n&&/[0-9.]/.test(src[j]))j++;t.push({k:'num',v:src.slice(i,j),s:i,e:j});i=j;continue;}
    if(/[A-Za-z_$]/.test(c)){let j=i;while(j<n&&/[A-Za-z0-9_$]/.test(src[j]))j++;t.push({k:'word',v:src.slice(i,j),s:i,e:j});i=j;continue;}
    if(src.startsWith(':=',i)){t.push({k:'op',v:':=',s:i,e:i+2});i+=2;continue;}
    if(src.startsWith('||',i)){t.push({k:'op',v:'||',s:i,e:i+2});i+=2;continue;}
    t.push({k:'punct',v:c,s:i,e:i+1});i++;
  }
  return t;
}

// PL/SQL 블록 → 구조 트리 + 대입변수 + 자유변수
function parseProgram(rawSrc){
  const src=stripComments(rawSrc);
  const toks=lex(src);
  let P=0;
  const isW=up=>toks[P]&&toks[P].k==='word'&&toks[P].v.toUpperCase()===up;
  function stmts(){
    const nodes=[];
    while(P<toks.length){
      const t=toks[P];
      if(t.k==='word'){
        const w=t.v.toUpperCase();
        if(w==='END'||w==='ELSIF'||w==='ELSE')return nodes;
        if(w==='IF'){nodes.push(parseIf());continue;}
        if(w==='FOR'||w==='WHILE'||w==='LOOP'){skipLoop();nodes.push({type:'unsupported'});continue;}
        if(toks[P+1]&&toks[P+1].k==='op'&&toks[P+1].v===':='){nodes.push(parseAssign());continue;}
        P++;continue;
      }
      P++;
    }
    return nodes;
  }
  function parseAssign(){
    const name=toks[P].v;P+=2; // word, :=
    const start=toks[P]?toks[P].s:0;let end=start;
    while(P<toks.length&&!(toks[P].k==='punct'&&toks[P].v===';')){end=toks[P].e;P++;}
    if(P<toks.length)P++; // ;
    return {type:'assign',var:name,expr:src.slice(start,end).trim()};
  }
  function readCond(){
    const start=toks[P]?toks[P].s:0;let end=start,depth=0;
    while(P<toks.length){
      const t=toks[P];
      if(t.k==='punct'&&t.v==='(')depth++;
      else if(t.k==='punct'&&t.v===')')depth--;
      else if(t.k==='word'&&t.v.toUpperCase()==='THEN'&&depth===0){P++;break;}
      end=t.e;P++;
    }
    return src.slice(start,end).trim();
  }
  function parseIf(){
    P++; // IF
    const branches=[{cond:readCond(),nodes:stmts()}];
    let elseNodes=null;
    while(P<toks.length){
      if(isW('ELSIF')){P++;branches.push({cond:readCond(),nodes:stmts()});continue;}
      if(isW('ELSE')){P++;elseNodes=stmts();continue;}
      if(isW('END')){P++;if(isW('IF'))P++;if(toks[P]&&toks[P].v===';')P++;break;}
      break;
    }
    return {type:'if',branches,elseNodes};
  }
  function skipLoop(){
    let depth=0,started=false;
    while(P<toks.length){
      if(isW('LOOP')){depth++;started=true;P++;continue;}
      if(isW('END')&&toks[P+1]&&toks[P+1].v.toUpperCase()==='LOOP'){depth--;P+=2;if(toks[P]&&toks[P].v===';')P++;if(started&&depth<=0)return;continue;}
      P++;
    }
  }
  const program=stmts();
  const accVars=new Set();
  (function w(l){for(const n of l){if(n.type==='assign')accVars.add(n.var);else if(n.type==='if'){n.branches.forEach(b=>w(b.nodes));if(n.elseNodes)w(n.elseNodes);}}})(program);
  return {program,accVars:[...accVars],freeVars:collectVars(program,accVars)};
}

const _KW=new Set(['AND','OR','NOT','IN','IS','NULL','LIKE','THEN','BETWEEN','ELSE','ELSIF','END','IF','LOOP','FOR','WHILE']);
function collectVars(program,accVars){
  const acc=accVars instanceof Set?accVars:new Set(accVars);const set=new Set();
  function scan(raw){const tk=lex(raw);for(let i=0;i<tk.length;i++){const t=tk[i];if(t.k!=='word')continue;
    const call=tk[i+1]&&tk[i+1].k==='punct'&&tk[i+1].v==='(';
    if(call||_KW.has(t.v.toUpperCase())||acc.has(t.v))continue;set.add(t.v);}}
  (function w(l){for(const n of l){if(n.type==='assign')scan(n.expr);else if(n.type==='if'){n.branches.forEach(b=>{scan(b.cond);w(b.nodes);});if(n.elseNodes)w(n.elseNodes);}}})(program);
  return [...set];
}

// 조건 평가: =, <>/!=, IN, NOT IN, IS [NOT] NULL, LIKE, AND/OR, 괄호
function evalCond(raw,vars){
  const tk=lex(raw);let p=0;
  const val=name=>{const k=Object.keys(vars).find(x=>x.toLowerCase()===name.toLowerCase());return k?vars[k]:'';};
  const unq=s=>s.slice(1,-1).replace(/''/g,"'");
  const wU=up=>tk[p]&&tk[p].k==='word'&&tk[p].v.toUpperCase()===up;
  function orE(){let v=andE();while(wU('OR')){p++;const r=andE();v=v||r;}return v;}
  function andE(){let v=atom();while(wU('AND')){p++;const r=atom();v=v&&r;}return v;}
  function readList(){const out=[];if(tk[p]&&tk[p].v==='(')p++;while(tk[p]&&tk[p].v!==')'){if(tk[p].k==='str')out.push(unq(tk[p].v));else if(tk[p].k==='num')out.push(tk[p].v);p++;}if(tk[p]&&tk[p].v===')')p++;return out;}
  function rhs(){if(tk[p]&&tk[p].k==='str')return unq(tk[p++].v);if(tk[p]&&tk[p].k==='num')return tk[p++].v;return '';}
  function atom(){
    if(tk[p]&&tk[p].k==='punct'&&tk[p].v==='('){p++;const v=orE();if(tk[p]&&tk[p].v===')')p++;return v;}
    if(wU('NOT')){p++;return !atom();}
    if(!(tk[p]&&tk[p].k==='word'))return true; // 못 읽으면 분기 유지
    const name=tk[p].v;p++;
    if(wU('IS')){p++;let neg=false;if(wU('NOT')){neg=true;p++;}if(wU('NULL'))p++;const nul=val(name)==='';return neg?!nul:nul;}
    let notIn=false;if(wU('NOT')){notIn=true;p++;}
    if(wU('IN')){p++;const has=readList().includes(val(name));return notIn?!has:has;}
    if(wU('LIKE')){p++;const s=rhs();const re=new RegExp('^'+s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/%/g,'.*').replace(/_/g,'.')+'$');return re.test(val(name));}
    if(tk[p]&&tk[p].k==='punct'){
      const op=tk[p].v;
      if(op==='='){p++;return val(name)===rhs();}
      if(op==='<'||op==='>'||op==='!'){p++;if(tk[p]&&tk[p].k==='punct'&&(tk[p].v==='='||tk[p].v==='>'))p++;return val(name)!==rhs();}
    }
    return true;
  }
  try{return !!orE();}catch(e){return true;}
}

// 실행: 분기 선택 + 조각 조립 → 대입변수별 결과 (append 마다 줄바꿈 유지)
function assemble(program,vars){
  const acc={};
  const ev=_evalExpr();
  function evalConcat(expr){
    if(!expr||!expr.trim())return '';
    const env={};
    for(const t of lex(expr)) if(t.k==='word'&&!(t.v in env)){
      const kv=Object.keys(vars).find(x=>x.toLowerCase()===t.v.toLowerCase());
      env[t.v]={t:'str',v: kv?vars[kv] : (t.v in acc?acc[t.v]:'')};
    }
    try{const r=ev(expr,env);return r&&r.v!==undefined?String(r.v):'';}catch(e){return '[[식 평가 실패: '+e.message+']]';}
  }
  function assign(nd){
    const tk=lex(nd.expr);
    // VAR := VAR || <rest> → rest 만 평가해 '새 줄'로 추가 (동적쿼리 가독성 유지)
    if(tk[0]&&tk[0].k==='word'&&tk[0].v.toLowerCase()===nd.var.toLowerCase()&&tk[1]&&tk[1].k==='op'&&tk[1].v==='||'){
      const line=evalConcat(tk[2]?nd.expr.slice(tk[2].s):'');
      acc[nd.var]=(acc[nd.var]===undefined||acc[nd.var]==='')?line:acc[nd.var]+'\n'+line;
    }else{
      acc[nd.var]=evalConcat(nd.expr); // 초기화/치환
    }
  }
  (function walk(list){
    for(const nd of list){
      if(nd.type==='assign')assign(nd);
      else if(nd.type==='if'){
        let taken=false;
        for(const b of nd.branches){if(evalCond(b.cond,vars)){walk(b.nodes);taken=true;break;}}
        if(!taken&&nd.elseNodes)walk(nd.elseNodes);
      }
    }
  })(program);
  return acc;
}

// IF 조건에 쓰인 값을 변수 기본값으로 (예: ISTOTAL='Y' → ISTOTAL 기본값 'Y', IN(...)는 첫 값)
function condDefaults(program){
  const map={};
  function scan(raw){
    let m;
    const reEq=/([A-Za-z_$][\w$]*)\s*=\s*'((?:[^']|'')*)'/g;
    while((m=reEq.exec(raw))) if(!(m[1] in map)) map[m[1]]=m[2].replace(/''/g,"'");
    const reIn=/([A-Za-z_$][\w$]*)\s+IN\s*\(\s*'((?:[^']|'')*)'/gi;
    while((m=reIn.exec(raw))) if(!(m[1] in map)) map[m[1]]=m[2].replace(/''/g,"'");
  }
  (function w(l){for(const n of l){if(n.type==='if'){n.branches.forEach(b=>{scan(b.cond);w(b.nodes);});if(n.elseNodes)w(n.elseNodes);}}})(program);
  return map;
}

// 최종 SQL로 볼 대입변수 추정 (SELECT 포함 + 가장 긴 것)
function mainVar(acc){
  let best=null,score=-1;
  for(const k in acc){const v=acc[k]||'';const s=(/select/i.test(v)?1e7:0)+v.length;if(s>score){score=s;best=k;}}
  return best;
}

if(typeof module!=='undefined') module.exports={parseProgram,assemble,evalCond,mainVar,collectVars,condDefaults};
