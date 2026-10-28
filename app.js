'use strict';
// ヒヤリハットと同じ構造：申込は端末内へ保存し、管理画面から明示的にサーバーへ送信する。
const STORAGE_KEY='spotcare_records_v1';
const SERVER_URL_KEY='spotcare_server_url';
const DEFAULT_SERVER_URL='http://192.168.1.60:3000';
const app=document.getElementById('app');let records=[],mode='home',step=0,editId=null,calendarDate=new Date(),reachedFinalStep=false;

function loadLocalRecords(){
  const raw=localStorage.getItem(STORAGE_KEY);
  if(raw===null)return [];
  const value=JSON.parse(raw); // 破損データを空として上書きしない
  if(!Array.isArray(value))throw new Error('端末の保存データの形式が正しくありません。');
  return value;
}
function saveLocalRecords(items){
  localStorage.setItem(STORAGE_KEY,JSON.stringify(items)); // 容量超過時は例外を出し、成功と表示しない
}
function makeId(){
  if(typeof crypto!=='undefined'&&typeof crypto.randomUUID==='function')return crypto.randomUUID();
  const bytes=new Uint8Array(16);
  if(typeof crypto!=='undefined'&&typeof crypto.getRandomValues==='function')crypto.getRandomValues(bytes);
  else for(let i=0;i<bytes.length;i++)bytes[i]=Math.floor(Math.random()*256);
  bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const h=[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
function serverURL(){return (localStorage.getItem(SERVER_URL_KEY)||DEFAULT_SERVER_URL).trim().replace(/\/+$/,'');}

const Q=[
 ['今までに入院をともなう病気、ケガをしたことがありますか？',['有りの場合、どういったものでしょうか？']],
 ['食物アレルギーなどはありますか？',['有りの場合、どういったものでしょうか？','具体的に食べられないものをお書きください。']],
 ['喘息などのアレルギーはありますか？',['有りの場合、どういったものでしょうか？']],
 ['今までにひきつけ、又はけいれん等を起こしたことはありますか？',['有りの場合、いつ頃でしょうか？']],
 ['現在飲んでいるお薬はありますか？',['薬の名前と服用方法をご記入ください。']],
 ['かかりつけの病院はありますか？',['病院名・診療科・電話番号をご記入ください。']]
];
const fresh=()=>({child:{received:localDate(new Date()),name:'',kana:'',nickname:'',gender:'',birth:''},care:{date:'',dates:[],plan:'',startTime:'',endTime:'',lunch:false,reason:''},survey:Q.map(()=>({answer:'',details:[]})),guardian:{name:'',relation:'',postal:'',prefecture:'',city:'',street:'',building:'',address:'',phone:'',contacts:[{name:'',relation:'',phone:''},{name:'',relation:'',phone:''},{name:'',relation:'',phone:''}],homePhone:''}});
let data=fresh();function localDate(d){return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function header(){return '<header><b>🌿 Spot Care <span class="small">一時預かり保育</span></b><span class="muted small">こどもの笑顔を大切に</span></header>'}
function mount(html){app.innerHTML=header()+'<main class="container">'+html+'</main>'}
function age(birth,at){if(!birth||!at)return '—';let b=new Date(birth+'T12:00:00'),d=new Date(at+'T12:00:00');if(isNaN(b)||isNaN(d)||d<b)return '—';let m=(d.getFullYear()-b.getFullYear())*12+d.getMonth()-b.getMonth();if(d.getDate()<b.getDate())m--;return Math.floor(m/12)+'歳'+m%12+'か月'}
// 利用希望日が属する年度の4月1日時点のクラス年齢（4月2日～翌4月1日生まれが同学年）
function classAge(birth,careDate){
 if(!birth||!careDate||birth>careDate)return null;
 const [by,bm,bd]=birth.split('-').map(Number),[cy,cm]=careDate.split('-').map(Number);
 if(!by||!bm||!bd||!cy||!cm)return null;
 const fiscalYear=cm>=4?cy:cy-1;
 return Math.max(0,fiscalYear-by-(bm>4||(bm===4&&bd>=2)?1:0));
}
function feeDetails(birth,careDate,plan,lunch=false){
 const n=classAge(birth,careDate);if(n===null)return null;
 const group=n===0?'0歳児クラス':n<=2?'1～2歳児クラス':n===3?'3歳児クラス':'4～5歳児クラス以上';
 const prices=n===0?[4000,7000]:n<=2?[3000,5000]:n===3?[2000,3000]:[1500,2000];
 const full=plan==='full'||((plan==='am'||plan==='pm')&&lunch);return {group,amount:prices[full?1:0],kind:plan==='full'?'1日':lunch?'半日（昼食付）':'半日'};
}
function feeSummary(){
 const dates=data.care.dates?.length?data.care.dates:[data.care.date].filter(Boolean);
 if(!dates.length)return '';
 let total=0;
 const rows=dates.map(date=>{const f=feeDetails(data.child.birth,date,data.care.plan,data.care.lunch);if(!f)return '';total+=f.amount;return `<tr><td>${esc(date)}</td><td>${f.group}</td><td>${f.kind}</td><td>${f.amount.toLocaleString('ja-JP')}円</td></tr>`}).join('');
 return `<h3>保育料金（利用希望日を基準に算出）</h3><div class="info-table-wrap"><table class="info-fees"><thead><tr><th>利用希望日</th><th>クラス区分</th><th>利用区分</th><th>料金</th></tr></thead><tbody>${rows}</tbody></table></div><p><strong>合計：${total.toLocaleString('ja-JP')}円</strong></p><p class="muted small">※利用希望日が属する年度の4月1日時点の年齢区分です。昼食を食べる場合は1日料金となります。</p>`;
}
function weekday(date){if(!date)return '';return '日月火水木金土'[new Date(date+'T12:00:00').getDay()]+'曜日'}
function field(label,key,value,type='text',required=false,extra=''){return `<div class="field"><label for="${key}">${label}${required?' <span class="req">必須</span>':''}</label><input id="${key}" type="${type}" value="${esc(value)}" ${required?'required':''} ${extra}></div>`}
function select(label,key,value,options,required=false){return `<div class="field"><label for="${key}">${label}${required?' <span class="req">必須</span>':''}</label><select id="${key}"><option value="">選択してください</option>${options.map(x=>`<option value="${esc(x[0])}" ${value===x[0]?'selected':''}>${esc(x[1])}</option>`).join('')}</select></div>`}
function setval(obj,key,id){const el=document.getElementById(id);if(el)obj[key]=el.value}
function infoPage(){mode='info';mount(`<div class="info-page"><div class="info-header"><h1>🌿 一時預かりについて</h1><p>こどもの森保育園では、一時預かり保育を行っております。</p><p>お預かりできるお子さんは、健康なお子様に限らせていただきます。</p></div><section class="info-section"><h2>🕘 保育時間</h2><p><strong>1日：</strong>午前9:00～午後5:00</p><p><strong>半日：</strong>午前9:00～午後1:00 ／ 午後1:00～午後5:00</p><p class="info-note">※土曜日は一時預かり保育を行っておりません。</p></section><section class="info-section"><h2>💴 保育料</h2><div class="info-table-wrap"><table class="info-fees"><thead><tr><th>年齢</th><th>半日</th><th>1日</th></tr></thead><tbody><tr><td>0歳児クラス</td><td>4,000円</td><td>7,000円</td></tr><tr><td>1～2歳児クラス</td><td>3,000円</td><td>5,000円</td></tr><tr><td>3歳児クラス</td><td>2,000円</td><td>3,000円</td></tr><tr><td>4～5歳児クラス以上</td><td>1,500円</td><td>2,000円</td></tr></tbody></table></div><p class="info-note">※昼食を食べる場合は1日料金となります。</p></section><section class="info-section"><h2>👜 持ち物</h2><ul><li>お着替え（少し多めに）</li><li>おむつが必要な場合は、おむつ及びおむつカバー</li><li>汚れものを入れるための袋（大きめのレジ袋など）</li><li>1日保育の場合は、お昼寝用のお布団</li></ul><p class="info-note">※持ち物には必ずお名前をご記入ください。</p></section><div class="info-actions"><button class="secondary" id="infoBack">← ホーム画面に戻る</button><button class="primary" id="infoApply">📝 一時預かり保育を申し込む</button></div></div>`);document.getElementById('infoBack').onclick=home;document.getElementById('infoApply').onclick=()=>{data=fresh();editId=null;step=0;reachedFinalStep=false;form()}}
function home(){mode='home';mount(`<div class="home-screen"><div class="leaf">🌿　🌼　🌳　🌷</div><h1><span class="pink">一時</span><span class="green">預かり</span><span class="blue">保育</span></h1><p class="lead">お子さまを安心してお預けいただけます</p><div class="home-box"><div class="children">🧒🏻　👧🏻　🏡</div><button class="primary home-apply" id="apply">📝　一時預かり保育を<br>申し込む　❯</button><p>利用希望日やお子さまの情報などを入力してお申し込みください。</p></div><button class="secondary home-info" id="info">📖　一時預かりについて　❯</button><button class="admin-link" id="admin">🔒 職員専用　管理画面へ　❯</button><p class="muted small">※こちらは職員専用のページです。</p></div>`);document.getElementById('apply').onclick=()=>{data=fresh();editId=null;step=0;reachedFinalStep=false;form()};document.getElementById('info').onclick=infoPage;document.getElementById('admin').onclick=()=>admin('list')}
function textArea(label,id,value,required=false,placeholder=''){return `<div class="field"><label for="${id}">${label}${required?' <span class="req">必須</span>':''}</label><textarea id="${id}" placeholder="${esc(placeholder)}">${esc(value)}</textarea></div>`}
const PLAN_LIMITS={full:['09:00','17:00'],am:['09:00','13:00'],pm:['13:00','17:00']};
function planOptions(){
 const v=data.care.plan||'';return `<div class="plan-main"><label class="plan-card ${v==='full'?'chosen':''}"><input type="radio" name="carekind" value="full" ${v==='full'?'checked':''}>1日 <small>9:00～17:00</small></label><label class="plan-card ${v==='am'||v==='pm'?'chosen':''}"><input type="radio" name="carekind" value="half" ${v==='am'||v==='pm'?'checked':''}>半日 <small>午前または午後</small></label></div><div id="halfOptions" class="half-options ${v==='am'||v==='pm'?'':'hidden'}"><label><input type="radio" name="halfkind" value="am" ${v==='am'?'checked':''}>午前（9:00～13:00）</label><label><input type="radio" name="halfkind" value="pm" ${v==='pm'?'checked':''}>午後（13:00～17:00）</label></div>`;
}
function timeFields(){return `<div class="time-entry"><p class="muted small">利用可能時間：1日 9:00～17:00 ／ 半日（午前）9:00～13:00 ／ 半日（午後）13:00～17:00</p><div class="time-pair"><div class="field"><label for="startTime">開始時刻 <span class="req">必須</span></label><input type="time" id="startTime" step="900" value="${esc(data.care.startTime||'')}"></div><div class="field"><label for="endTime">終了時刻 <span class="req">必須</span></label><input type="time" id="endTime" step="900" value="${esc(data.care.endTime||'')}"></div></div><p class="muted small">選択した区分の時間内で入力してください。</p><div id="lunchOption" class="lunch-option ${data.care.plan==='am'||data.care.plan==='pm'?'':'hidden'}"><label><input type="checkbox" id="lunch" ${data.care.lunch?'checked':''}> 昼食を食べる（1日料金になります）</label></div></div>`}
function timeError(){const p=data.care.plan,lim=PLAN_LIMITS[p];if(!lim)return '';const st=data.care.startTime,en=data.care.endTime;if(!st||!en)return '';if(st>=en)return '終了時刻は開始時刻より後にしてください。';if(st<lim[0]||en>lim[1])return `利用時間は${careLabel(p).split('（')[0]}の範囲（${lim[0]}～${lim[1]}）で入力してください。`;return ''}
function birthSelectors(){
 const parts=(data.child.birth||'').split('-');const now=new Date().getFullYear();
 const opts=(id,values,current,suffix)=>`<select id="${id}" aria-label="${suffix}"><option value="">${suffix}を選択</option>${values.map(n=>`<option value="${n}" ${String(Number(current))===String(n)?'selected':''}>${n}${suffix}</option>`).join('')}</select>`;
 return `<div class="field full"><label>生年月日 <span class="req">必須</span></label><div class="birth-row">${opts('birthYear',Array.from({length:13},(_,i)=>now-i),parts[0],'年')}${opts('birthMonth',Array.from({length:12},(_,i)=>i+1),parts[1],'月')}${opts('birthDay',Array.from({length:31},(_,i)=>i+1),parts[2],'日')}</div></div>`;
}
function form(){mode='form';let body='';
if(step===0){body=`<div class="child-avatars">👦🏻　👧🏻</div><div class="grid child-grid">${field('氏名','childname',data.child.name,'text',true,'placeholder="例）森田 花子"')}${field('ふりがな','kana',data.child.kana,'text',true,'placeholder="例）もりた はなこ"')}${field('家庭での呼び方','nickname',data.child.nickname,'text',false,'placeholder="例）はなちゃん"')}<div class="field"><label>性別 <span class="req">必須</span></label><div class="radio-row">${['男','女','その他'].map(v=>`<label><input type="radio" name="gender" value="${v}" ${data.child.gender===v?'checked':''}> ${v}</label>`).join('')}</div></div>${birthSelectors()}<div class="full info-strip"><span>申込日　<strong>${esc(data.child.received)}</strong></span><span>年齢（自動計算）　<strong id="age">${age(data.child.birth,data.child.received)}</strong></span></div></div>`}
if(step===1){let y=calendarDate.getFullYear(),m=calendarDate.getMonth(),first=new Date(y,m,1).getDay(),last=new Date(y,m+1,0).getDate();let cells=[];for(let i=0;i<first;i++)cells.push('<div></div>');for(let n=1;n<=last;n++){let dt=localDate(new Date(y,m,n)),off=[0,6].includes(new Date(y,m,n).getDay()),selected=(data.care.dates||[]).includes(dt);cells.push(`<button type="button" class="pick-day ${off?'disabled-day':''} ${selected?'selected-day':''}" data-date="${dt}" ${off?'disabled':''}>${n}</button>`)}body=`<div class="care-layout"><section class="form-panel"><div class="field"><label>利用希望日 <span class="req">必須</span></label><div class="month-nav"><button type="button" class="secondary" id="prevMonth">❮</button><strong>${y}年 ${m+1}月</strong><button type="button" class="secondary" id="nextMonth">❯</button></div><div class="pick-calendar">${'日月火水木金土'.split('').map(v=>`<div class="weekhead">${v}</div>`).join('')}${cells.join('')}</div><p class="muted small">※ 土曜日・日曜日は一時預かり保育を行っていません。</p><label>選択した日（複数選択できます）</label><div class="selected-list">${(data.care.dates||[]).map(v=>`<span class="date-chip">${v} <button type="button" class="remove-date" data-date="${v}">×</button></span>`).join('')||'カレンダーから日付を選択してください'}</div></div></section><section class="form-panel"><div class="field"><label>利用時間 <span class="req">必須</span></label><p class="muted small">※ 1日または半日を選択してください。</p><div class="plan-grid">${planOptions()}</div>${timeFields()}</div>${select('利用理由','reason',data.care.reason,[['就労','就労'],['通院','通院'],['冠婚葬祭','冠婚葬祭'],['リフレッシュ','リフレッシュ'],['その他','その他']],true)}</section></div>`}
if(step===2){body=`<p class="muted">お子さまの健康状態や生活の様子についてお答えください。「あり」を選んだ場合は、詳細をご入力ください。</p>`+Q.map((q,i)=>{let a=data.survey[i]||{answer:'',details:[]};let placeholders=['病名・時期・治療内容などをご記入ください。','例）卵、ピーナッツ、小麦など','例）ぜんそく（毎朝吸入）など','発症時の年齢・状況・治療内容など','薬の名前と服用方法をご記入ください。',''];return `<section class="question" data-question="${i}"><div class="question-title"><span class="question-no">${i+1}</span><strong>${esc(q[0])} <span class="req">必須</span></strong></div><div class="radio-row">${['なし','あり'].map(x=>`<label class="choice"><input type="radio" name="q${i}" value="${x}" ${a.answer===x?'checked':''}>${x}</label>`).join('')}</div><div id="details${i}" class="detail-box ${a.answer!=='あり'?'hidden':''}">${i===5?`<div class="grid">${field('病院名','detail5_0',a.details[0]||'','text',false,'placeholder="例）〇〇小児科"')}${field('診療科','detail5_1',a.details[1]||'','text',false,'placeholder="例）小児科"')}${field('電話番号','detail5_2',a.details[2]||'','tel',false,'placeholder="例）028-123-4567"')}</div>`:textArea(i===4?'現在飲んでいるお薬の内容':i===3?'発症時の年齢・状況・治療内容':i===0?'病名・時期・治療内容': '具体的な内容',`detail${i}_0`,a.details[0]||'',false,['例）2歳のとき肺炎で5日間入院','例）卵、ピーナッツ','例）ぜんそく（季節の変わり目に発作）','例）1歳6か月のとき熱性けいれん','例）ぜんそくの薬を朝・夜に服用'][i])}</div></section>`}).join('')}
if(step===3){body=`<div class="guardian-layout"><section class="form-panel">${field('保護者氏名','guardian',data.guardian.name,'text',true,'placeholder="例）森田 太郎"')}${select('続柄','guardianRelation',data.guardian.relation,[['父','父'],['母','母'],['祖父','祖父'],['祖母','祖母'],['その他','その他']],true)}<h3 class="subheading">🏠 住所</h3><div class="field"><label>郵便番号 <span class="req">必須</span></label><div class="postal-row"><input id="postal" inputmode="numeric" maxlength="8" placeholder="例）123-4567" value="${esc(data.guardian.postal)}"><button class="secondary" type="button" id="lookupPostal">住所検索</button></div><span class="muted small" id="postalStatus">郵便番号から住所を自動入力できます。</span></div>${field('都道府県','prefecture',data.guardian.prefecture,'text',true,'placeholder="例）栃木県"')}${field('市区町村・町名','city',data.guardian.city,'text',true,'placeholder="例）宇都宮市中央"')}${field('番地','street',data.guardian.street,'text',true,'placeholder="例）1-2-3"')}${field('建物名・部屋番号（任意）','building',data.guardian.building,'text',false,'placeholder="例）さくらマンション101号室"')}${field('電話番号','guardianPhone',data.guardian.phone||data.guardian.homePhone,'tel',true,'placeholder="例）090-1234-5678"')}</section><section class="form-panel"><h3 class="subheading">☎ 緊急連絡先 <small>（3つ入力できます）</small></h3>${[0,1,2].map(i=>`<section class="contact-block"><b>緊急連絡先 ${i+1} ${i<2?'<span class="req">必須</span>':'（任意）'}</b><div class="contact-fields">${field('氏名','contactName'+i,data.guardian.contacts[i].name||'','text',i<2,'placeholder="例）'+['森田 一郎','山田 太郎','山田 次郎'][i]+'"')}${select('続柄','relation'+i,data.guardian.contacts[i].relation,[['父','父'],['母','母'],['祖父','祖父'],['祖母','祖母'],['その他','その他']],i<2)}${field('電話番号','phone'+i,data.guardian.contacts[i].phone,'tel',i<2,'placeholder="例）090-1234-5678"')}</div></section>`).join('')}</section></div>`}
const titles=['お子さまの情報','利用希望の内容','健康状態・アンケート','保護者の情報'];
mount(`<div class="form-shell"><div class="form-heading"><h2>一時預かり保育 申込書</h2><p>４つの画面で、すべての項目をご入力ください。</p></div><div class="steps">${titles.map((x,i)=>`<div class="step ${reachedFinalStep?'step-clickable':''} ${i===step?'active':''} ${i<step?'done':''}"><span>${i+1}</span><div><b>${x}</b><small>${['お子さまの情報を入力してください。','利用を希望する日と時間をご入力ください。','お子さまの健康状態についてご入力ください。','保護者の方の情報と緊急連絡先をご入力ください。'][i]}</small></div></div>`).join('')}</div><div class="form-content theme-${step}"><h2><span class="section-icon">${['👦🏻','🗓️','🩺','👩🏻'][step]}</span>${titles[step]}</h2><div id="fields">${body}</div><p id="error" class="error" role="alert"></p><div class="actions"><button class="secondary" id="back">← 戻る</button><button class="primary" id="next">${step===3?'入力内容を確認する →':'次へ →'}</button></div></div></div>`);
document.querySelectorAll('.steps .step').forEach((tab,i)=>{
  if(!reachedFinalStep)return;
  tab.setAttribute('role','button');tab.setAttribute('tabindex','0');
  tab.setAttribute('aria-label',titles[i]+'に移動');
  const move=()=>{if(i===step)return;capture();step=i;form();};
  tab.addEventListener('click',move);
  tab.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();move();}});
});
document.getElementById('back').onclick=()=>{if(step===0){editId?admin('list'):home()}else{capture();step--;form()}};document.getElementById('next').onclick=next;
if(step===0){let update=()=>{const y=document.getElementById('birthYear').value,m=document.getElementById('birthMonth').value,d=document.getElementById('birthDay').value;let date='';if(y&&m&&d){const candidate=`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;const dt=new Date(candidate+'T12:00:00');if(dt.getFullYear()===+y&&dt.getMonth()+1===+m&&dt.getDate()===+d)date=candidate;}document.getElementById('age').textContent=age(date,data.child.received)};['birthYear','birthMonth','birthDay'].forEach(id=>document.getElementById(id).addEventListener('change',update))}
if(step===1){document.getElementById('prevMonth').onclick=()=>{capture();calendarDate=new Date(calendarDate.getFullYear(),calendarDate.getMonth()-1,1);form()};document.getElementById('nextMonth').onclick=()=>{capture();calendarDate=new Date(calendarDate.getFullYear(),calendarDate.getMonth()+1,1);form()};document.querySelectorAll('.pick-day:not(:disabled)').forEach(el=>el.onclick=()=>{capture();let ds=data.care.dates;data.care.dates=ds.includes(el.dataset.date)?ds.filter(x=>x!==el.dataset.date):[...ds,el.dataset.date].sort();form()});document.querySelectorAll('.remove-date').forEach(el=>el.onclick=()=>{capture();data.care.dates=data.care.dates.filter(x=>x!==el.dataset.date);form()});
 document.querySelectorAll('[name=carekind]').forEach(el=>el.onchange=()=>{capture();data.care.plan=el.value==='full'?'full':'am';if(data.care.plan==='full')data.care.lunch=false;const limits=PLAN_LIMITS[data.care.plan];data.care.startTime=limits[0];data.care.endTime=limits[1];form()});
 document.querySelectorAll('[name=halfkind]').forEach(el=>el.onchange=()=>{capture();data.care.plan=el.value;const limits=PLAN_LIMITS[data.care.plan];data.care.startTime=limits[0];data.care.endTime=limits[1];form()});
 document.getElementById('lunch').onchange=()=>{data.care.lunch=document.getElementById('lunch').checked};
 document.querySelectorAll('#startTime,#endTime').forEach(el=>el.addEventListener('change',()=>{capture();document.getElementById('error').textContent=timeError()}))} 
if(step===2)Q.forEach((_,i)=>document.querySelectorAll(`[name=q${i}]`).forEach(el=>el.onchange=()=>document.getElementById('details'+i).classList.toggle('hidden',el.value!=='あり')));
if(step===3)document.getElementById('lookupPostal').onclick=async()=>{let postal=document.getElementById('postal').value.replace(/\D/g,'');let status=document.getElementById('postalStatus');if(postal.length!==7){status.textContent='郵便番号は7桁で入力してください。';return}status.textContent='住所を検索しています…';try{let r=await fetch('https://zipcloud.ibsnet.co.jp/api/search?zipcode='+postal);let j=await r.json();if(!j.results?.length)throw Error('住所が見つかりません。');let x=j.results[0];document.getElementById('prefecture').value=x.address1;document.getElementById('city').value=x.address2+x.address3;status.textContent='住所を入力しました。番地をご入力ください。'}catch(e){status.textContent='住所を取得できませんでした。手入力してください。'}};
}

function capture(){if(step===0){[['name','childname'],['kana','kana'],['nickname','nickname']].forEach(([k,id])=>setval(data.child,k,id));const y=document.getElementById('birthYear').value,m=document.getElementById('birthMonth').value,d=document.getElementById('birthDay').value;data.child.birth=y&&m&&d?`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`:'';data.child.gender=document.querySelector('[name=gender]:checked')?.value||''}if(step===1){data.care.plan=document.querySelector('[name=carekind]:checked')?.value==='full'?'full':(document.querySelector('[name=halfkind]:checked')?.value||'');data.care.lunch=data.care.plan!=='full'&&!!document.getElementById('lunch')?.checked;setval(data.care,'startTime','startTime');setval(data.care,'endTime','endTime');setval(data.care,'reason','reason');data.care.date=(data.care.dates||[])[0]||''}if(step===2)Q.forEach((q,i)=>{let selected=document.querySelector(`[name=q${i}]:checked`);let count=i===5?3:1;data.survey[i]={answer:selected?selected.value:'',details:Array.from({length:count},(_,j)=>document.getElementById(`detail${i}_${j}`).value)}});if(step===3){[['name','guardian'],['relation','guardianRelation'],['phone','guardianPhone'],['postal','postal'],['prefecture','prefecture'],['city','city'],['street','street'],['building','building']].forEach(([k,id])=>setval(data.guardian,k,id));data.guardian.address=[data.guardian.prefecture,data.guardian.city,data.guardian.street,data.guardian.building].filter(Boolean).join('');data.guardian.contacts.forEach((c,i)=>{setval(c,'name','contactName'+i);setval(c,'relation','relation'+i);setval(c,'phone','phone'+i)})}}
// 入力エラーは具体的な案内をダイアログに表示し、該当欄を赤枠で強調する。
function reportErrors(errors){
 if(!errors.length)return true;
 document.querySelectorAll('.input-invalid').forEach(el=>el.classList.remove('input-invalid'));
 for(const err of errors){
  const el=document.getElementById(err.id)||document.querySelector(err.selector||'#___missing');
  if(el){(err.group?el.closest(err.group):el)?.classList.add('input-invalid');}
 }
 const first=errors[0];
 alert('次の項目を確認してください。\n\n'+errors.map((e,i)=>`${i+1}. ${e.message}`).join('\n'));
 const el=document.getElementById(first.id)||document.querySelector(first.selector||'#___missing');
 if(el){el.scrollIntoView({behavior:'smooth',block:'center'});if(el.matches('input,select,textarea')&&!el.disabled)el.focus({preventScroll:true});}
 return false;
}
function validationErrors(){
 const errors=[];const add=(id,message,extra={})=>errors.push({id,message,...extra});
 const required=(id,label)=>{const el=document.getElementById(id);if(!el||!el.value.trim())add(id,`${label}を入力してください。`)};
 if(step===0){
  required('childname','お子さまの氏名');required('kana','ふりがな');
  if(!data.child.gender)add('','性別を選択してください。',{selector:'.radio-row'});
  if(!data.child.birth)add('birthYear','生年月日を年・月・日すべて選択してください。',{group:'.birth-row'});
  else if(data.child.birth>data.child.received||age(data.child.birth,data.child.received)==='—')add('birthYear','生年月日を正しく入力してください。',{group:'.birth-row'});
 }
 if(step===1){
  if(!(data.care.dates||[]).length)add('','利用希望日をカレンダーから選択してください。',{selector:'.pick-calendar'});
  if((data.care.dates||[]).some(x=>[0,6].includes(new Date(x+'T12:00:00').getDay())))add('','利用希望日は月曜日から金曜日を選択してください。',{selector:'.pick-calendar'});
  if(!data.care.plan)add('','利用区分（1日・半日）を選択してください。',{selector:'.plan-main'});
  else if(!PLAN_LIMITS[data.care.plan])add('','半日の場合は午前・午後を選択してください。',{selector:'#halfOptions'});
  required('startTime','開始時刻');required('endTime','終了時刻');
  if(data.care.startTime&&data.care.endTime){
   const p=data.care.plan,lim=PLAN_LIMITS[p],st=data.care.startTime,en=data.care.endTime;
   if(st>=en)add('endTime','終了時刻は開始時刻より後にしてください。');
   else if(lim){if(st<lim[0])add('startTime',`開始時刻は${lim[0]}以降にしてください。`);if(en>lim[1])add('endTime',`終了時刻は${lim[1]}までにしてください。`)}
  }
  required('reason','利用理由');
 }
 if(step===2){data.survey.forEach((item,i)=>{
  if(!item.answer)add('',`アンケート${i+1}番の「なし」「あり」を選択してください。`,{selector:`.question[data-question="${i}"]`});
  else if(item.answer==='あり'){
   const count=1; // かかりつけ病院は病院名のみ必須
   for(let j=0;j<count;j++){
    const el=document.getElementById(`detail${i}_${j}`);
    if(el&&!el.value.trim())add(`detail${i}_${j}`,`アンケート${i+1}番の${i===5?['病院名','診療科','電話番号'][j]:'詳細'}を入力してください。`);
   }
  }
 })}
 if(step===3){
  [['guardian','保護者氏名'],['guardianRelation','保護者の続柄'],['postal','郵便番号'],['prefecture','都道府県'],['city','市区町村・町名'],['street','番地'],['guardianPhone','保護者の電話番号']].forEach(([id,label])=>required(id,label));
  for(let i=0;i<3;i++){
   const ids=['contactName'+i,'relation'+i,'phone'+i];
   if(i<2||ids.some(id=>document.getElementById(id)?.value.trim())){
    [['氏名',ids[0]],['続柄',ids[1]],['電話番号',ids[2]]].forEach(([label,id])=>required(id,`緊急連絡先${i+1}の${label}`));
   }
  }
 }
 return errors;
}
async function next(){capture();if(!reportErrors(validationErrors()))return;if(step<3){step++;if(step===3)reachedFinalStep=true;form();return}confirmForm();}
function confirmForm(){mount(`<div class="form-shell confirm-page"><div class="form-heading"><h2>入力内容の確認</h2><p>内容をご確認のうえ、保存してください。</p></div><div class="form-content"><h3>お子さまの情報</h3><p>${esc(data.child.name)}（${esc(data.child.kana)}）　${esc(age(data.child.birth,data.child.received))}</p><p>生年月日：${esc(data.child.birth)}　家庭での呼び方：${esc(data.child.nickname)}</p><h3>利用希望の内容</h3><p>${(data.care.dates||[]).map(esc).join('、')}</p><p>${esc(careLabel(data.care.plan))}　${esc(data.care.startTime||PLAN_LIMITS[data.care.plan]?.[0]||'')}～${esc(data.care.endTime||PLAN_LIMITS[data.care.plan]?.[1]||'')}　利用理由：${esc(data.care.reason)}</p>${data.care.lunch&&data.care.plan!=='full'?'<p><strong>昼食あり（1日料金）</strong></p>':''}${feeSummary()}<h3>健康状態・アンケート</h3>${Q.map((q,i)=>`<p>${i+1}. ${esc(q[0])}　<strong>${esc(data.survey[i].answer)}</strong>${data.survey[i].answer==='あり'?'　'+data.survey[i].details.map(esc).join(' / '):''}</p>`).join('')}<h3>保護者の情報</h3><p>${esc(data.guardian.name)}（${esc(data.guardian.relation)}）　${esc(data.guardian.phone)}</p><p>〒${esc(data.guardian.postal)}　${esc(data.guardian.address)}</p><h3>緊急連絡先</h3>${data.guardian.contacts.map((c,i)=>`<p>${i+1}. ${esc(c.name)}　${esc(c.relation)}　${esc(c.phone)}</p>`).join('')}<div class="confirm-agreement"><label for="confirmAgree"><input type="checkbox" id="confirmAgree"> <span>上記の内容に同意します。</span></label></div><p id="error" class="error" role="alert"></p><div class="actions"><button class="secondary" id="back">← 修正する</button><button class="primary" id="next" disabled>${editId?'変更を保存':'この内容で申し込む'}</button></div></div></div>`);document.getElementById('back').onclick=()=>form();document.getElementById('confirmAgree').onchange=e=>{document.getElementById('next').disabled=!e.target.checked;};document.getElementById('next').onclick=saveApplication;}
function saveApplication(){
 const btn=document.getElementById('next');
 if(!document.getElementById('confirmAgree')?.checked)return;
 btn.disabled=true;
 try{
   const previous=loadLocalRecords();
   const now=new Date().toISOString();
   const existing=editId?previous.find(r=>r.id===editId):null;
   if(editId&&!existing)throw new Error('編集対象の申込が見つかりません。');
   const id=editId||makeId();
   const item={...data,id,app:'spotcare',schemaVersion:1,
     createdAt:existing?.createdAt||now,updatedAt:now};
   const updated=editId?previous.map(r=>r.id===id?item:r):[...previous,item];
   saveLocalRecords(updated);
   mount(`<div class="card hero"><h1>✓ ${editId?'変更を端末に保存しました':'申込内容を端末に保存しました'}</h1><p>受付番号：${esc(id)}</p><p class="notice">サーバーへの送信はまだ行っていません。職員専用の管理画面から「サーバーに送信」を押してください。</p><button class="primary" id="finish">${editId?'申込一覧へ':'メイン画面へ'}</button></div>`);
   document.getElementById('finish').onclick=()=>editId?admin('list'):home();
 }catch(e){document.getElementById('error').textContent='端末への保存に失敗しました：'+e.message;btn.disabled=false;}
}
function admin(tab='list'){
 mode='admin';
 try{records=loadLocalRecords()}catch(e){mount(`<div class="card error">端末の保存データを読み込めません：${esc(e.message)}</div><button class="secondary" id="toHome">メイン画面に戻る</button>`);document.getElementById('toHome').onclick=home;return;}
 drawAdmin(tab);
}
function drawAdmin(tab){
 mount(`<div class="tabs"><button id="listTab" class="tab ${tab==='list'?'active':''}">申込一覧</button><button id="calendarTab" class="tab ${tab==='calendar'?'active':''}">カレンダー</button><button id="serverTab" class="tab ${tab==='server'?'active':''}">サーバー送信・管理</button></div><div id="panel"></div><div class="right"><button id="toHome" class="secondary small">メイン画面に戻る</button></div>`);
 document.getElementById('listTab').onclick=()=>drawAdmin('list');
 document.getElementById('calendarTab').onclick=()=>drawAdmin('calendar');
 document.getElementById('serverTab').onclick=()=>drawAdmin('server');
 document.getElementById('toHome').onclick=home;
 if(tab==='list')listView();else if(tab==='calendar')calendarView();else serverView();
}
function serverView(){
 document.getElementById('panel').innerHTML=`<div class="card"><h2>サーバー送信</h2>
  <p>この端末に保存した <strong>${records.length}件</strong> の申込データを、園のサーバーへ送信します。</p>
  <div class="field"><label for="serverUrl">園内PC URL</label><input type="url" id="serverUrl" value="${esc(serverURL())}" placeholder="http://192.168.1.60:3000"></div>
  <div class="sync-actions"><button class="secondary" id="saveUrl">URLを保存</button><button class="primary" id="sendServer">サーバーに送信</button></div>
  <p id="serverStatus" role="status" aria-live="polite" class="muted small">送信は自動では行われません。</p>
  <p class="notice">送信すると、サーバーのSpot Care申込データがこの端末の一覧で置き換わります。別の端末の申込データにはご注意ください。</p>
  </div><div class="card"><h2>データ保全</h2><p>端末内の申込一覧をJSONファイルとしてバックアップ・復元できます。</p>
  <div class="sync-actions"><button class="secondary" id="backup">バックアップ</button><button class="secondary" id="restore">データ復元</button><input type="file" id="restoreFile" accept=".json,application/json" hidden></div>
  </div>`;
 const input=document.getElementById('serverUrl');
 const normalized=()=>input.value.trim().replace(/\/+$/,'');
 document.getElementById('saveUrl').onclick=()=>{
   const url=normalized();if(!/^https?:\/\/[^/]+$/i.test(url)){alert('園内PC URLを正しく入力してください。');return;}
   try{localStorage.setItem(SERVER_URL_KEY,url);input.value=url;document.getElementById('serverStatus').textContent='URLを保存しました。'}catch(e){alert('URLを保存できませんでした：'+e.message)}
 };
 document.getElementById('sendServer').onclick=async()=>{
   const url=normalized();
   if(!/^https?:\/\/[^/]+$/i.test(url)){alert('園内PC URLを正しく入力してください。');return;}
   let items;
   try{items=loadLocalRecords()}catch(e){alert('端末データを読み込めません：'+e.message);return;}
   if(!items.length){alert('送信する申込データがありません。');return;}
   if(!confirm(`${items.length}件の申込をサーバーに送信します。\nサーバー側のSpot Care申込一覧は、この端末の一覧で置き換わります。\nよろしいですか？`))return;
   const button=document.getElementById('sendServer');button.disabled=true;
   const status=document.getElementById('serverStatus');status.textContent='サーバーに送信しています…';
   try{
     const host=new URL(url).hostname.toLowerCase();
     const space=host==='localhost'||host==='127.0.0.1'?'loopback':
       (/^192\.168\.|^10\.|^172\.(1[6-9]|2[0-9]|3[01])\./.test(host)?'local':null);
     const response=await fetch(`${url}/api/spotcare`,{method:'POST',headers:{'Content-Type':'application/json'},
       ...(space?{targetAddressSpace:space}:{}),
       body:JSON.stringify({app:'spotcare',savedAt:new Date().toISOString(),payload:items})});
     const result=await response.json().catch(()=>({}));
     if(!response.ok||result.ok!==true||result.mode!=='bulk'||result.count!==items.length)throw new Error(result.message||'サーバーの送信結果を確認できません。server.jsが更新されているか確認してください。');
     localStorage.setItem(SERVER_URL_KEY,url);input.value=url;
     status.textContent=`${items.length}件のサーバー保存が完了しました。`;
   }catch(e){status.textContent='送信に失敗しました。端末の記録は残っています。';alert('サーバーに送信できませんでした。\n'+e.message+'\n園内PC URL、server.js、Chromeのローカルネットワークへのアクセス許可を確認してください。');}
   finally{button.disabled=false;}
 };
 document.getElementById('backup').onclick=()=>{
   try{
     const items=loadLocalRecords();
     const file=new Blob([JSON.stringify({app:'spotcare',exportedAt:new Date().toISOString(),payload:items},null,2)],{type:'application/json'});
     const link=document.createElement('a');const url=URL.createObjectURL(file);
     link.href=url;link.download=`spotcare-backup-${localDate(new Date())}.json`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);
   }catch(e){alert('バックアップできませんでした：'+e.message);}
 };
 document.getElementById('restore').onclick=()=>document.getElementById('restoreFile').click();
 document.getElementById('restoreFile').onchange=async e=>{
   const file=e.target.files?.[0];if(!file)return;
   try{
     const v=JSON.parse(await file.text());
     if(v?.app!=='spotcare'||!Array.isArray(v.payload)||!v.payload.every(r=>r&&typeof r.id==='string'&&r.child&&r.care&&r.guardian&&Array.isArray(r.survey)))throw Error('Spot Careのバックアップではありません。');
     if(!confirm(`バックアップの${v.payload.length}件で、この端末の申込一覧を置き換えます。よろしいですか？`))return;
     saveLocalRecords(v.payload);records=loadLocalRecords();drawAdmin('server');
     document.getElementById('serverStatus').textContent='端末に復元しました。サーバーにはまだ送信していません。';
   }catch(err){alert('復元できませんでした：'+err.message)}finally{e.target.value='';}
 };
}
function careLabel(v){return {full:'1日',am:'半日（午前）',pm:'半日（午後）'}[v]||v}
function careDisplay(c){const p=PLAN_LIMITS[c.plan]||[];return careLabel(c.plan)+' '+(c.startTime||p[0]||'')+'～'+(c.endTime||p[1]||'')}
function listView(){document.getElementById('panel').innerHTML=`<div class="card"><h2>申込一覧</h2><div class="toolbar"><input id="search" placeholder="園児名で検索"><label>利用希望日 <input type="date" id="filterdate"></label><button class="secondary" id="clear">条件クリア</button></div><div class="tablewrap"><table><thead><tr><th>受付日</th><th>利用希望日</th><th>園児名</th><th>年齢</th><th>利用時間</th><th>利用理由</th><th>操作</th></tr></thead><tbody id="rows"></tbody></table></div></div>`;let s=document.getElementById('search'),d=document.getElementById('filterdate');function render(){let items=records.flatMap(r=>(r.care.dates?.length?r.care.dates:[r.care.date]).map(date=>({...r,displayDate:date}))).filter(r=>(!s.value||r.child.name.includes(s.value)||r.child.kana.includes(s.value))&&(!d.value||r.displayDate===d.value)).sort((a,b)=>a.displayDate.localeCompare(b.displayDate));document.getElementById('rows').innerHTML=items.map(r=>`<tr><td>${esc(r.child.received)}</td><td>${esc(r.displayDate)}（${weekday(r.displayDate)}）</td><td>${esc(r.child.name)}</td><td>${esc(age(r.child.birth,r.child.received))}</td><td>${esc(careDisplay(r.care))}</td><td>${esc(r.care.reason||'')}</td><td><button class="secondary edit" data-id="${esc(r.id)}">編集</button></td></tr>`).join('')||'<tr><td colspan="7">該当する申込はありません</td></tr>';document.querySelectorAll('.edit').forEach(b=>b.onclick=()=>edit(b.dataset.id))}s.oninput=d.onchange=render;document.getElementById('clear').onclick=()=>{s.value='';d.value='';render()};render()}
function edit(id){let r=records.find(x=>x.id===id);if(!r)return;data=JSON.parse(JSON.stringify(r));data.survey=Q.map((_,i)=>{let a=data.survey?.[i]||{answer:'',details:[]};return {...a,answer:a.answer==='有り'?'あり':a.answer==='無し'?'なし':a.answer}});data.care.dates=data.care.dates?.length?data.care.dates:[data.care.date].filter(Boolean);data.care.startTime ||= PLAN_LIMITS[data.care.plan]?.[0]||'';data.care.endTime ||= PLAN_LIMITS[data.care.plan]?.[1]||'';data.guardian={...fresh().guardian,...data.guardian};data.guardian.contacts=[0,1,2].map(i=>data.guardian.contacts?.[i]||{name:'',relation:'',phone:''});editId=id;step=0;reachedFinalStep=true;form()}
function calendarView(){let y=calendarDate.getFullYear(),m=calendarDate.getMonth(),first=new Date(y,m,1).getDay(),last=new Date(y,m+1,0).getDate();let cells=[];for(let i=0;i<first;i++)cells.push('<div></div>');for(let n=1;n<=last;n++){let date=localDate(new Date(y,m,n)),items=records.filter(r=>(r.care.dates?.length?r.care.dates:[r.care.date]).includes(date)),off=[0,6].includes(new Date(y,m,n).getDay());cells.push(`<div class="day ${off?'off':''}"><div class="date">${n}日 <span class="muted small">${items.length?items.length+'人':''}</span></div>${items.map(r=>`<div class="entry" data-id="${esc(r.id)}" title="${esc(careDisplay(r.care))}">${esc(r.child.name)}</div>`).join('')}</div>`)}document.getElementById('panel').innerHTML=`<div class="card"><div class="toolbar"><button class="secondary" id="prev">← 前月</button><h2>${y}年${m+1}月</h2><button class="secondary" id="nextMonth">翌月 →</button></div><div class="calendar">${'日月火水木金土'.split('').map(x=>`<div class="weekday">${x}</div>`).join('')}${cells.join('')}</div><p class="muted small">園児名を押すと申込内容を編集できます。</p></div>`;document.getElementById('prev').onclick=()=>{calendarDate=new Date(y,m-1,1);calendarView()};document.getElementById('nextMonth').onclick=()=>{calendarDate=new Date(y,m+1,1);calendarView()};document.querySelectorAll('.entry').forEach(el=>el.onclick=()=>edit(el.dataset.id))}
home();
