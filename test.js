// 평가기 검증: node test.js
const {parseInit,evalExpr,literalOf}=require('./app.js');

function run(label,init,free,expect){
  const env={};for(const k in free)env[k]={t:'str',v:free[k]};
  let ok=true;
  for(const a of parseInit(init)){
    if(!a.expr)continue; // 수동입력(테이블 조회)은 검증 대상 아님
    let got;try{const v=evalExpr(a.expr,env);env[a.name]=v;got=literalOf(v);}catch(e){got='ERROR: '+e.message;}
    if(a.name in expect){
      const pass=got===expect[a.name];ok=ok&&pass;
      console.log(' '+(pass?'PASS':'FAIL')+' '+a.name+' = '+got+(pass?'':'  expect '+expect[a.name]));
    }
  }
  console.log(label+': '+(ok?'OK':'FAILED')+'\n');
  return ok;
}

let all=true;

all&=run('패턴: V_PROC (YYYYMMDD)',`
V_PROC_DATE := TO_DATE(P_PROC_YM||'01','YYYYMMDD');
V_PROC_S_DATE := TO_CHAR(V_PROC_DATE, 'YYYY-MM-DD');
V_PROC_E_DATE := TO_CHAR(LAST_DAY(V_PROC_DATE), 'YYYY-MM-DD');
V_PROC_LAST_DATE := TO_DATE(V_PROC_E_DATE || ' 23:59:59', 'YYYY-MM-DD HH24:MI:SS');
V_PROC_S_MINUS_59_DATE := TO_CHAR(V_PROC_DATE - 59, 'YYYY-MM-DD');
V_PROC_E_PLUS_7_DATE := ADD_MONTHS(TO_DATE(P_PROC_YM||'01','YYYYMMDD'), 1) + 7;`,
{P_PROC_YM:'202606'},
{V_PROC_DATE:"TO_DATE('2026-06-01','YYYY-MM-DD')",V_PROC_S_DATE:"'2026-06-01'",V_PROC_E_DATE:"'2026-06-30'",V_PROC_LAST_DATE:"TO_DATE('2026-06-30 23:59:59','YYYY-MM-DD HH24:MI:SS')",V_PROC_S_MINUS_59_DATE:"'2026-04-03'",V_PROC_E_PLUS_7_DATE:"TO_DATE('2026-07-08','YYYY-MM-DD')"});

all&=run('패턴: 1개인자 TO_DATE + 소문자마스크',`
p_strStartDt := TO_CHAR(TO_DATE(P_PROC_YM || '01'), 'yyyy-MM-dd');
p_strEndDt := TO_CHAR(LAST_DAY(TO_DATE(P_PROC_YM || '01')), 'yyyy-MM-dd');
p_strYearMonth := TO_CHAR(TO_DATE(p_strStartDt, 'yyyy-MM-dd'), 'yyyyMM');
p_strYearMonthDay := TO_CHAR(TO_DATE(p_strEndDt, 'yyyy-MM-dd'), 'yyyyMMdd');
p_CURR_YEARMONTH := TO_CHAR(TO_DATE(p_strEndDt, 'yyyy-MM-dd'), 'yyyy-MM');`,
{P_PROC_YM:'202606'},
{p_strStartDt:"'2026-06-01'",p_strEndDt:"'2026-06-30'",p_strYearMonth:"'202606'",p_strYearMonthDay:"'20260630'",p_CURR_YEARMONTH:"'2026-06'"});

all&=run('패턴: 식별자대입 + 중첩 TO_CHAR/TO_DATE',`
P_strOrganizationCode := P_PROC_YM;
P_strFirstDate := TO_DATE(P_strOrganizationCode || '01', 'yyyy-MM-dd');
P_strLastDate := TO_DATE(TO_CHAR(P_strFirstDate, 'yyyy-MM') || '-' || TO_CHAR(LAST_DAY(P_strFirstDate), 'DD') || ' 23:59:59', 'yyyy-MM-dd hh24:mi:ss');`,
{P_PROC_YM:'202606'},
{P_strOrganizationCode:"'202606'",P_strFirstDate:"TO_DATE('2026-06-01','YYYY-MM-DD')",P_strLastDate:"TO_DATE('2026-06-30 23:59:59','YYYY-MM-DD HH24:MI:SS')"});

all&=run('패턴: SELECT .. INTO .. FROM DUAL + SUBSTR/REPLACE',`
SELECT SUBSTR(REPLACE(P_PROC_DATE, '-', ''), 1, 6) INTO V_YEARMONTH FROM DUAL;
SELECT TO_CHAR(ADD_MONTHS(TO_DATE(P_PROC_DATE, 'YYYY-MM-DD'), -1), 'YYYYMM') INTO V_RE_PURCHS_EXCCLC_YM FROM DUAL;
SELECT TO_CHAR(TO_DATE(V_YEARMONTH || '08', 'YYYY-MM-DD'), 'YYYY-MM-DD') INTO V_CANCELDATE FROM DUAL;
SELECT TO_CHAR(ADD_MONTHS( TO_DATE(V_YEARMONTH || '08', 'YYYY-MM-DD'), 1), 'YYYY-MM-DD') INTO V_CANCELDATE1 FROM DUAL;
SELECT COUNT(*) INTO V_IS_EXISTS FROM TBL_CRM_CHARGE_NEWPAY tccn WHERE YEARMONTH = V_YEARMONTH;`,
{P_PROC_DATE:'2026-06-01'},
{V_YEARMONTH:"'202606'",V_RE_PURCHS_EXCCLC_YM:"'202605'",V_CANCELDATE:"'2026-06-08'",V_CANCELDATE1:"'2026-07-08'"});

all&=run('패턴: 리터럴대입 + 괄호식 + 중첩',`
V_C_PROCYM :=  TO_CHAR(TO_DATE(P_PROC_DATE ,'YYYY-MM-DD') ,'YYYYMM');
V_D_SDATE  :=  TO_DATE(V_C_PROCYM || '01' ,'YYYY-MM-DD');
V_C8_SDATE :=  TO_CHAR(V_D_SDATE ,'YYYYMMDD');
V_D_EDATE  :=  LAST_DAY(V_D_SDATE);
V_C8_EDATE :=  TO_CHAR(V_D_EDATE ,'YYYYMMDD');
V_BIZ_CD   :=  '100';
V_C_BFR_YM :=  TO_CHAR((V_D_SDATE - 1), 'YYYYMM');`,
{P_PROC_DATE:'2026-06-01'},
{V_C_PROCYM:"'202606'",V_D_SDATE:"TO_DATE('2026-06-01','YYYY-MM-DD')",V_C8_SDATE:"'20260601'",V_D_EDATE:"TO_DATE('2026-06-30','YYYY-MM-DD')",V_C8_EDATE:"'20260630'",V_BIZ_CD:"'100'",V_C_BFR_YM:"'202605'"});

all&=run('패턴: 한 SELECT에서 다중 INTO (DUAL)',`
SELECT
  TO_CHAR(TO_DATE(P_PROC_YM ||'01', 'YYYY-MM-DD'),'YYYY-MM-DD')
  , TO_CHAR(LAST_DAY(TO_DATE(P_PROC_YM ||'01', 'YYYY-MM-DD')),'YYYYMMDD')
  , TO_CHAR(TO_DATE(P_PROC_YM ||'01', 'YYYY-MM-DD') - 1,'YYYYMM')
  , TO_CHAR(LAST_DAY(TO_DATE(P_PROC_YM || '01','YYYYMMDD')) + 1,'YYYY-MM-DD')
  INTO
  V_strStartDt      --정산연월1일
  , V_strEndDt      --정산연월마지막일
  , V_strLastMonth  --적재전월
  , V_strNextStartDt --적재다음달1일
  FROM DUAL;`,
{P_PROC_YM:'202507'},
{V_strStartDt:"'2025-07-01'",V_strEndDt:"'20250731'",V_strLastMonth:"'202506'",V_strNextStartDt:"'2025-08-01'"});

all&=run('패턴: TO_NUMBER + 날짜함수에 문자열 암묵변환',`
SELECT
  P_PROC_YM
  , SUBSTR(P_PROC_YM,1,4) || '-'||SUBSTR(P_PROC_YM,5,2)
  , TO_CHAR(TO_DATE(P_PROC_YM ||'01'),'YYYY-MM-DD')
  , TO_CHAR(LAST_DAY(TO_DATE(P_PROC_YM || '01','YYYYMMDD')),'YYYY-MM-DD')
  , TO_NUMBER(TO_CHAR(LAST_DAY(P_PROC_YM  || '01'),'DD') )
  INTO V_strYearMonth
  , V_CURR_YEARMONTH
  , V_strStartDt
  , V_strEndDt
  , v_intMonthDay
  FROM DUAL;`,
{P_PROC_YM:'202507'},
{V_strYearMonth:"'202507'",V_CURR_YEARMONTH:"'2025-07'",V_strStartDt:"'2025-07-01'",V_strEndDt:"'2025-07-31'",v_intMonthDay:"31"});

console.log(all?'=== 전체 통과 ===':'=== 실패 있음 ===');
process.exit(all?0:1);
