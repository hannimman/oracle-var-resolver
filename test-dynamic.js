// 동적 조립 검증: node test-dynamic.js
const {parseProgram,assemble,mainVar,evalCond,condDefaults}=require('./dynamic.js');

let all=true;
const chk=(label,cond)=>{all=all&&cond;console.log(' '+(cond?'PASS':'FAIL')+' '+label);};

const SRC=`
V_SQL := 'SELECT T01.PROC_YM AS "01" FROM TB_B20H380G T01 ';
IF ISTOTAL = 'N' THEN
  V_SQL := V_SQL || ' WHERE T01.PROC_YM = '''||P_PROC_YM||''' ';
  V_SQL := V_SQL || ' AND T01.DEPT_CD = '''||P_DEPT_CD||''' ';
END IF;
IF ISTOTAL = 'Y' THEN
  V_SQL := V_SQL || ' WHERE T01.PROC_YM = '''||P_PROC_YM||''' ';
  V_SQL := V_SQL || ' AND T02.TEAM_CD LIKE ''%'||P_TEAM_CD||'%'' ';
  IF P_PART_CD IS NOT NULL THEN
    V_SQL := V_SQL || ' AND T02.PART_CD LIKE ''%'||P_PART_CD||'%'' ';
  END IF;
END IF;`;

const {program,accVars,freeVars}=parseProgram(SRC);
chk('대입변수 = V_SQL', accVars.length===1 && accVars[0]==='V_SQL');
chk('자유변수 감지(ISTOTAL,P_PROC_YM,P_DEPT_CD,P_TEAM_CD,P_PART_CD)',
    ['ISTOTAL','P_PROC_YM','P_DEPT_CD','P_TEAM_CD','P_PART_CD'].every(v=>freeVars.includes(v)));

// 조건 기본값 (IF 에 쓰인 값)
const defs=condDefaults(program);
chk("조건 기본값: ISTOTAL 채워짐", defs.ISTOTAL==='N'||defs.ISTOTAL==='Y');

// ISTOTAL = N
let r=assemble(program,{ISTOTAL:'N',P_PROC_YM:'202606',P_DEPT_CD:'1'}).V_SQL;
console.log('  [N]\n'+r);
chk("N: 삽입값 '202606' 반영", r.includes("T01.PROC_YM = '202606'"));
chk("N: DEPT_CD '1' 반영", r.includes("T01.DEPT_CD = '1'"));
chk("N: Y분기(TEAM_CD) 미포함", !r.includes('TEAM_CD'));
chk("N: 줄바꿈 유지(여러 줄)", r.split('\n').length>=3);

// ISTOTAL = Y, P_PART_CD 없음 → PART 분기 제외
r=assemble(program,{ISTOTAL:'Y',P_PROC_YM:'202606',P_TEAM_CD:'T1',P_PART_CD:''}).V_SQL;
console.log('  [Y,part=∅] '+r);
chk("Y: TEAM_CD LIKE '%T1%' 반영", r.includes("TEAM_CD LIKE '%T1%'"));
chk('Y: PART_CD 분기 제외(IS NOT NULL=false)', !r.includes('PART_CD'));
chk('Y: N분기(DEPT_CD) 미포함', !r.includes('DEPT_CD'));

// ISTOTAL = Y, P_PART_CD 있음 → PART 분기 포함
r=assemble(program,{ISTOTAL:'Y',P_PROC_YM:'202606',P_TEAM_CD:'T1',P_PART_CD:'PP'}).V_SQL;
chk("Y: PART_CD LIKE '%PP%' 포함", r.includes("PART_CD LIKE '%PP%'"));

// 값에 따옴표째 입력해도 (습관) — 겹따옴표 없이 정상 처리
r=assemble(program,{ISTOTAL:"'Y'",P_PROC_YM:"'202606'",P_TEAM_CD:"'T1'",P_PART_CD:''}).V_SQL;
console.log('  [따옴표째] '+r.replace(/\n/g,' | '));
chk("따옴표째: Y분기 선택됨", r.includes('TEAM_CD'));
chk("따옴표째: 삽입값 겹따옴표 아님('202606')", r.includes("PROC_YM = '202606'") && !r.includes("''202606''"));
chk("따옴표째: TEAM '%T1%' (겹따옴표 아님)", r.includes("LIKE '%T1%'"));

// 조건 평가 단위 테스트
chk("cond: IN 매칭",  evalCond("P_CLSF_CD IN('20','30')",{P_CLSF_CD:'20'})===true);
chk("cond: IN 불일치", evalCond("P_CLSF_CD IN('20','30')",{P_CLSF_CD:'10'})===false);
chk("cond: IS NULL",   evalCond("P_X IS NULL",{P_X:''})===true);
chk("cond: IS NOT NULL", evalCond("P_X IS NOT NULL",{P_X:'a'})===true);
chk("cond: 대소문자 무시(istotal)", evalCond("ISTOTAL = 'Y'",{istotal:'Y'})===true);

console.log(all?'\n=== 동적 조립 전체 통과 ===':'\n=== 실패 있음 ===');
process.exit(all?0:1);
