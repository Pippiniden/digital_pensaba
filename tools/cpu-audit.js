// CPU の判断の点検：CPU 同士を対戦させて「あやしい判断」の回数を数える（強さ＝勝率では見えない不自然さを数字にする）
//
//   node tools/cpu-audit.js                 全ルール × 400試合（つよい同士・先読みなし）
//   node tools/cpu-audit.js -n 1000         試合数（ルールごと）
//   node tools/cpu-audit.js -r team,simple  ルールを絞る（rules.js の RULESETS のキー）
//   node tools/cpu-audit.js -l normal       CPU の強さ（既定：hard）
//   node tools/cpu-audit.js --look          「つよい」の先読みを有効にする（実際のゲームと同じ。かなり遅い）
//   node tools/cpu-audit.js --vs HEAD       勝率の比較：いまの js/cpu.js と、git のその版の js/cpu.js を対戦させる（陣営は1試合ごとに入れ替え）
//   node tools/cpu-audit.js --set "DANGER_K=.7"  cpu.js の調整用の変数（let）を書き換えて回す（;で区切って複数）
//   node tools/cpu-audit.js --vs old.js     同じく、取っておいた cpu.js のコピーと対戦させる（コミット前の変更どうしを比べるとき）
//
// 数えているもの：
//   - 攻撃宝具がすべて回避・無敵で防がれた（空撃ち）／全体宝具が一部の敵に防がれた
//   - 通常攻撃を回避・無敵の相手に向けた（防がれない別の相手がいたのに）
//   - 宝具を撃てるのに撃たなかった手番、NP100%のまま戦闘不能になった数（被弾で貯まった直後に倒された分も含む）
//   - 対象を選ぶスキルの攻撃強化を、そのターン攻撃しない味方に付けた
//   - 試合が終わったときの未使用スキル、一度も／ほとんど使われないスキル
// 判断を直したら、直す前と同じ表を出して回数が減ったかを見る。強さは --vs で勝率を見る（±の幅に入っていれば差なし）。
'use strict';
const fs=require('fs'), vm=require('vm'), path=require('path'), cp=require('child_process');
const argv=process.argv.slice(2), opt=(...names)=>{ const i=argv.findIndex(a=>names.includes(a)); return i<0?null:argv[i+1]; }, flag=n=>argv.includes(n);
const N=Math.max(1,Number(opt('-n','--games'))||400), ONLY=opt('-r','--rule'), LEVEL=opt('-l','--level')||'hard', LOOK=flag('--look'), VS=opt('--vs'), SET=opt('--set');

const store=()=>({getItem(){return null},setItem(){},removeItem(){}});
const ctx={console,Math,Date,JSON,localStorage:store(),sessionStorage:store(),document:{},setTimeout(){return 0},clearTimeout(){}};
ctx.window=ctx; vm.createContext(ctx);
const root=path.join(__dirname,'..'), dir=path.join(root,'js');
for(const f of ['rules','units','masters','common','engine','cpu']) vm.runInContext(fs.readFileSync(path.join(dir,f+'.js'),'utf8'),ctx,{filename:f+'.js'});
vm.runInContext('function render(){}',ctx);
if(SET) vm.runInContext(SET,ctx,{filename:'--set'}); // 調整用の変数を書き換える（いまの cpu.js 側だけ。--vs の相手には効かない）
// --vs：比べる相手の cpu.js を、名前がぶつからないよう関数の中に閉じ込めて読み込む（G やエンジンは共有）
if(VS){
  let old; try{ old=fs.existsSync(VS)?fs.readFileSync(VS,'utf8'):cp.execFileSync('git',['show',`${VS}:js/cpu.js`],{cwd:root,encoding:'utf8',maxBuffer:1<<26}); }catch(e){ console.error(`${VS} を読めません（git の版か、cpu.js のコピーのファイル名）`); process.exit(1); }
  vm.runInContext(`const OLD_CPU=(function(){\n${old}\n;return {decide:()=>cpuDecide(), look:v=>{ CPU_LOOKAHEAD=v; }};})();`,ctx,{filename:`cpu.js@${VS}`});
}

const body=function(N,ONLY,LEVEL,LOOK,VS){
  CPU_LOOKAHEAD=!!LOOK; if(VS) OLD_CPU.look(!!LOOK);
  const rules=Object.keys(RULESETS).filter(k=>!ONLY||ONLY.split(',').includes(k));
  const strip=s=>String(s).replace(/<[^>]+>/g,''), guarded=t=>has(t,'invul')||has(t,'evade');
  const ATK=['atk','atkPct','critPow','critRoll','critMult','atkVs','atkTrait','onAtkNp','onAtkStar','cardUp','aoeNormal','cardConv'];
  const setup=rule=>{
    newGame({rule,handicap:false});
    act('chooseMode',{mode:'watch',level:LEVEL,level2:LEVEL});
    act('setupRandom'); act('setupConfirm'); act('setupCpu',{how:'same'}); act('setupConfirm');
    return G.phase!=='setup'&&G.phase!=='mode';
  };
  const res={};
  for(const rule of rules){
    if(VS){ // 勝率だけを見る
      let w=0, g=0;
      for(let i=0;i<N;i++){
        const NEW=i%2; if(!setup(rule)) continue;
        let steps=0;
        while(G.phase!=='over'&&G.turn<=200&&steps++<60000){
          G.level=G.levels[actor()];
          const m=actor()===NEW?cpuDecide():OLD_CPU.decide(); if(!m) break;
          act(m[0],m[1]||{}); FXQ.length=0; FXHIDE.clear(); if(G.log.length>300) G.log.splice(0,200);
        }
        if(G.phase==='over'){ g++; if(G.winner===NEW) w++; }
      }
      res[rule]={vs:true,g,w}; continue;
    }
    const S={games:0,turns:0,ultDmg:0,ultAoe:0,ultAllBlocked:0,ultAoeAllBlocked:0,ultAoePartBlocked:0,ultSingleBlocked:0,ultSingleAlt:0,
      atk:0,atkIntoGuard:0,atkIntoGuardAlt:0,holdTurns:0,holdSupport:0,diedFullNp:0,units:0,
      outLeft:0,outAll:0,loserLeft:0,loserAll:0,winnerLeft:0,winnerAll:0,pickBuff:0,pickBuffIdle:0,use:{},seen:{},examples:[]};
    for(let g=0;g<N;g++){
      if(!setup(rule)) continue;
      S.games++;
      G.players.forEach(P=>P.party.forEach(u=>{ S.units++; D(u.def).skills.forEach((s,si)=>{ if(s.eff.some(e=>e.k!=='desc')){ const k=u.def+'#'+si; S.seen[k]=(S.seen[k]||0)+1; } }); }));
      let steps=0;
      while(G.phase!=='over'&&G.turn<=200&&steps++<60000){
        G.level=G.levels[actor()];
        const m=cpuDecide(); if(!m) break;
        const L0=G.log.length; let obs=null;
        if(m[0]==='useSkill'){ const k=U(m[1].uid).def+'#'+Number(m[1].si); S.use[k]=(S.use[k]||0)+1; }
        if(G.phase==='skill'&&G.pending&&!G.pending.ult&&m[0]==='cardClick'){ // 対象を選ぶスキル：攻撃強化を付けた味方が、このターン攻撃するか
          const u=U(G.pending.uid), s=D(u.def).skills[G.pending.si], t=U(m[1].uid);
          if(t.pid===u.pid&&s.eff.some(e=>e.t==='picked'&&ATK.includes(e.k))&&skillCands(u,s).length>1){ S.pickBuff++; if(!(G.ult?G.ult===t.uid:(G.alloc[t.uid]||0)>0)) S.pickBuffIdle++; }
        }
        if(m[0]==='skillDone'&&!G.ult&&!G.ultDone){
          const c=alive(G.cur).filter(u=>canUlt(u)&&u.np>=RULES.ultCost);
          if(c.length){ S.holdTurns++; if(c.some(u=>!D(u.def).ult.eff.some(e=>e.k==='dmg'||e.k==='copyRoll'))) S.holdSupport++; }
        }
        if(G.phase==='target'&&m[0]==='resolve'){
          const tg=U(G.target), cands=targetCandidates();
          if(G.ult){
            const u=U(G.ult), ud=D(u.def).ult;
            if(ud.eff.some(e=>e.k==='dmg')) obs={ult:true,aoe:G.targetAll,name:`${D(u.def).name}「${ud.name}」`,alt:!G.targetAll&&cands.some(t=>t!==tg&&!guarded(t)),
              foes:(G.targetAll?alive(1-G.cur):[tg]).map(t=>D(t.def).name+(has(t,'invul')?'[無敵]':'')+(has(t,'evade')?'[回避]':'')).join(' / ')};
          } else if(G.rolled.some(r=>r.cmd.dmg>0)) obs={ult:false,tgG:guarded(tg),alt:cands.some(t=>t!==tg&&!guarded(t))};
        }
        act(m[0],m[1]||{}); FXQ.length=0; FXHIDE.clear();
        if(obs&&obs.ult){
          const lines=G.log.slice(L0).map(l=>strip(l.msg));
          const blk=lines.filter(l=>/^→ .*無効/.test(l)).length, hit=lines.filter(l=>/^→ .*ダメージ/.test(l)&&!/無効/.test(l)).length;
          S.ultDmg++; if(obs.aoe) S.ultAoe++;
          if(blk&&!hit){ S.ultAllBlocked++; if(obs.aoe) S.ultAoeAllBlocked++; else { S.ultSingleBlocked++; if(obs.alt) S.ultSingleAlt++; }
            if(S.examples.length<5) S.examples.push(`ターン${G.turn} ${obs.name}（${obs.aoe?'全体':'単体'}）→ ${obs.foes}`); }
          else if(obs.aoe&&blk) S.ultAoePartBlocked++;
        } else if(obs){ S.atk++; if(obs.tgG){ S.atkIntoGuard++; if(obs.alt) S.atkIntoGuardAlt++; } }
        if(G.log.length>600) G.log.splice(0,400);
      }
      S.turns+=G.turn;
      if(G.phase==='over') G.players.forEach((P,pid)=>P.party.forEach(u=>{
        if(u.out&&u.np>=RULES.ultCost) S.diedFullNp++;
        D(u.def).skills.forEach((s,si)=>{ if(!s.eff.some(e=>e.k!=='desc')||(si===2&&!u.asc)) return;
          if(u.out){ S.outAll++; if(!u.used[si]) S.outLeft++; }
          if(pid===G.winner){ S.winnerAll++; if(!u.used[si]) S.winnerLeft++; } else { S.loserAll++; if(!u.used[si]) S.loserLeft++; } });
      }));
    }
    const label=k=>{ const [id,si]=k.split('#'), s=D(id).skills[si]; return `${D(id).name}「${s.name}」（${[...new Set(s.eff.map(e=>FX[e.k]?FX[e.k].name:e.k))].join('・')}） ${S.use[k]||0}/${S.seen[k]}`; };
    const often=Object.keys(S.seen).filter(k=>S.seen[k]>=15);
    S.never=often.filter(k=>!S.use[k]).map(label); S.rare=often.filter(k=>S.use[k]&&S.use[k]/S.seen[k]<.15).map(label);
    delete S.use; delete S.seen; res[rule]=S;
  }
  return res;
};
const out=vm.runInContext(`(${body})(${N},${JSON.stringify(ONLY)},${JSON.stringify(LEVEL)},${LOOK},${JSON.stringify(VS)})`,ctx);

const p=(a,b)=>b?`${a}/${b}（${(a/b*100).toFixed(1)}%）`:`${a}/0`;
for(const [rule,S] of Object.entries(out)){
  if(S.vs){ const r=S.w/S.g, se=Math.sqrt(r*(1-r)/S.g)*196; console.log(`${rule}：いまの cpu.js の勝ち ${S.w}/${S.g} ＝ ${(r*100).toFixed(1)}% ±${se.toFixed(1)}（相手：${VS} の cpu.js／${LEVEL}・先読み${LOOK?'あり':'なし'}）`); continue; }
  console.log(`\n===== ${rule}：${S.games}試合・平均${(S.turns/S.games).toFixed(1)}ターン（${LEVEL} 同士・先読み${LOOK?'あり':'なし'}） =====`);
  console.log(`攻撃宝具がすべて防がれた（空撃ち）    ${p(S.ultAllBlocked,S.ultDmg)}`);
  console.log(`  全体宝具：全員に防がれた            ${p(S.ultAoeAllBlocked,S.ultAoe)}　一部の敵に防がれた ${p(S.ultAoePartBlocked,S.ultAoe)}`);
  console.log(`  単体宝具：防がれた                  ${S.ultSingleBlocked}回　うち防がれない別の相手がいた ${S.ultSingleAlt}回`);
  console.log(`通常攻撃を回避・無敵の相手に向けた    ${p(S.atkIntoGuard,S.atk)}　うち防がれない別の相手がいた ${S.atkIntoGuardAlt}回`);
  console.log(`攻撃強化を攻撃しない味方に付けた      ${p(S.pickBuffIdle,S.pickBuff)}（対象を選ぶスキル）`);
  console.log(`宝具を撃てるのに撃たなかった手番      ${S.holdTurns}回　うち補助宝具を持っていた ${S.holdSupport}回`);
  console.log(`NP100%のまま戦闘不能                  ${p(S.diedFullNp,S.units)}`);
  console.log(`戦闘不能になった騎の未使用スキル      ${p(S.outLeft,S.outAll)}`);
  console.log(`未使用スキル：負けた側                ${p(S.loserLeft,S.loserAll)}　勝った側 ${p(S.winnerLeft,S.winnerAll)}`);
  console.log(`一度も使われないスキル（15回以上出場）${S.never.length}件`); S.never.forEach(x=>console.log('    '+x));
  console.log(`ほとんど使われないスキル（15%未満）   ${S.rare.length}件`); S.rare.forEach(x=>console.log('    '+x));
  if(S.examples.length){ console.log('空撃ちの例：'); S.examples.forEach(x=>console.log('    '+x)); }
}
