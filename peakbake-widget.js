const PBW = (function() {

  var FRACS = {0.125:'\u215b',0.25:'\u00bc',0.333:'\u2153',0.375:'\u215c',0.5:'\u00bd',0.625:'\u215d',0.667:'\u2154',0.75:'\u00be',0.875:'\u215e'};
  var GRAM  = { flour:120, water:237, _tsp:{yeast:3,salt:6,sugar:4.2}, _tbsp:{sugar:12.5} };
  var LIQUID = { water:true };
  var TYPES  = { flour:'FLOUR', water:'LIQUID', yeast:'LEAVENING', sugar:'SUGAR', salt:'NONE' };

  var INGS = [
    {id:'flour', amount:3.5,  unit:'cups', name:'Bread flour'},
    {id:'water', amount:1.25, unit:'cups', name:'Warm water'},
    {id:'yeast', amount:2.25, unit:'tsp',  name:'Active dry yeast'},
    {id:'sugar', amount:1,    unit:'tbsp', name:'Sugar'},
    {id:'salt',  amount:1.5,  unit:'tsp',  name:'Sea salt'},
  ];

  var fUnit='cups', pUnit='cups', fShown=false, pShown=false;
  var cache = null;

  function frac(v) {
    var w=Math.floor(v), f=Math.round((v-w)*1000)/1000, fs=FRACS[f]||(f>0?String(f):'');
    return w===0?(fs||'0'):(fs?w+fs:String(w));
  }
  function roundU(v,u) {
    if(u==='cups') return Math.round(v*4)/4;
    if(u==='tbsp') return Math.round(v*2)/2;
    if(u==='tsp')  return Math.round(v*4)/4;
    return Math.round(v*100)/100;
  }
  function toG(a,u,id) {
    if(u==='cups') return Math.round(a*(GRAM[id]||120));
    if(u==='tsp')  return Math.round(a*(GRAM._tsp[id]||4));
    if(u==='tbsp') return Math.round(a*(GRAM._tbsp[id]||14));
    return Math.round(a);
  }
  function gUnit(u,id) { return (u==='cups'&&LIQUID[id])?'ml':'g'; }

  function calcAdj(ing, elevFt, humidity) {
    var t=TYPES[ing.id];
    var adj=ing.amount, delta=0;
    var alt=null;
    if(elevFt>7000)      alt={lm:0.50,lpc:0.25, tf:25,bm:-8, pm:-20};
    else if(elevFt>5000) alt={lm:0.65,lpc:0.125,tf:15,bm:-6, pm:-15};
    else if(elevFt>3500) alt={lm:0.75,lpc:0.125,tf:0, bm:-4, pm:-10};
    if(alt) {
      if(t==='LEAVENING'){adj=Math.max(ing.amount*alt.lm,ing.amount*0.25);delta=adj-ing.amount;}
      if(t==='LIQUID'){var ex=ing.amount*alt.lpc;adj=ing.amount+ex;delta=ex;}
    }
    if(humidity>70){if(t==='FLOUR'){adj+=0.125;delta+=0.125;}if(t==='LIQUID'){adj-=0.125;delta-=0.125;}}
    else if(humidity<30){if(t==='FLOUR'){adj-=0.125;delta-=0.125;}if(t==='LIQUID'){adj+=0.125;delta+=0.125;}}
    return {id:ing.id,amount:ing.amount,unit:ing.unit,name:ing.name,adj:adj,delta:delta,alt:alt};
  }

  function dispAmt(ing,mode) {
    if(mode==='grams') return toG(ing.adj,ing.unit,ing.id)+gUnit(ing.unit,ing.id);
    return frac(roundU(ing.adj,ing.unit))+' '+ing.unit;
  }
  function dispOrig(ing,mode) {
    if(Math.abs(ing.delta)<0.005) return null;
    var a=dispAmt(ing,mode);
    var o=mode==='grams'?toG(ing.amount,ing.unit,ing.id)+gUnit(ing.unit,ing.id):frac(roundU(ing.amount,ing.unit))+' '+ing.unit;
    if(a===o) return null;
    return (ing.delta>0?'\u25b2':'\u25bc')+' was '+o;
  }

  function reverseGeocode(lat,lon) {
    return fetch('https://nominatim.openstreetmap.org/reverse?lat='+lat+'&lon='+lon+'&format=json',{headers:{'Accept-Language':'en'}})
      .then(function(r){return r.json();})
      .then(function(d){
        var cc=((d.address&&d.address.country_code)||'us').toUpperCase();
        var city=d.address&&(d.address.city||d.address.town||d.address.village||d.address.county)||'';
        var state=d.address&&d.address.state_code||'';
        var ctry=d.address&&d.address.country||'';
        var name=cc==='US'&&city&&state?city+', '+state:city?city+', '+ctry:lat.toFixed(2)+'\u00b0, '+lon.toFixed(2)+'\u00b0';
        return {name:name,cc:cc};
      })
      .catch(function(){return {name:lat.toFixed(2)+'\u00b0, '+lon.toFixed(2)+'\u00b0',cc:'US'};});
  }

  function fetchAtmo(lat,lon) {
    return Promise.all([
      fetch('https://api.open-meteo.com/v1/elevation?latitude='+lat+'&longitude='+lon),
      fetch('https://api.open-meteo.com/v1/forecast?latitude='+lat+'&longitude='+lon+'&current=relative_humidity_2m,surface_pressure')
    ]).then(function(rs){return Promise.all(rs.map(function(r){return r.json();}));})
      .then(function(data){
        var elevFt=Math.round(((data[0].elevation&&data[0].elevation[0])||0)*3.28084);
        var humidity=(data[1].current&&data[1].current.relative_humidity_2m)||50;
        var pressure=Math.round((data[1].current&&data[1].current.surface_pressure)||1013);
        return {elevFt:elevFt,humidity:humidity,pressure:pressure};
      });
  }

  function doAdjust(callback) {
    if(cache){callback(cache);return;}
    if(!navigator.geolocation){callback(null);return;}
    navigator.geolocation.getCurrentPosition(function(pos){
      var lat=pos.coords.latitude,lon=pos.coords.longitude;
      Promise.all([fetchAtmo(lat,lon),reverseGeocode(lat,lon)])
        .then(function(res){
          var atmo=res[0],geo=res[1];
          var METRIC={DE:1,FR:1,IT:1,ES:1,PT:1,NL:1,BE:1,AT:1,CH:1,SE:1,NO:1,DK:1,FI:1,AU:1,NZ:1,GB:1,IE:1,JP:1,KR:1,CN:1,TW:1,BR:1,AR:1,MX:1};
          var defaultUnit=METRIC[geo.cc]?'grams':'cups';
          var results=INGS.map(function(ing){return calcAdj(ing,atmo.elevFt,atmo.humidity);});
          var alt=results[0].alt;
          var bake=alt?{tf:alt.tf,bm:alt.bm,pm:alt.pm}:null;
          cache={results:results,bake:bake,locName:geo.name,elevFt:atmo.elevFt,humidity:atmo.humidity,pressure:atmo.pressure,defaultUnit:defaultUnit};
          fUnit=defaultUnit; pUnit=defaultUnit;
          callback(cache);
        })
        .catch(function(){callback(null);});
    },function(){callback(null);},{timeout:10000,maximumAge:60000});
  }

  function renderFreeList(mode) {
    var list=document.getElementById('pb-free-ing-list');
    if(!list) return;
    list.innerHTML='';
    cache.results.forEach(function(ing){
      var orig=dispOrig(ing,mode);
      var dir=ing.delta>0.005?'up':ing.delta<-0.005?'dn':'no';
      list.innerHTML+='<li class="pb-ing-row-sm"><span class="pb-ing-name-sm">'+ing.name+'</span><span class="pb-ing-amt-sm">'+dispAmt(ing,mode)+'</span><span class="pb-ing-orig-sm '+dir+'">'+(orig||'')+'</span></li>';
    });
    var ts=mode==='grams'?'+8\u00b0C':'+15\u00b0F';
    var cards=document.getElementById('pb-free-bake');
    if(cards&&cache.bake) cards.innerHTML=
      '<div class="pb-bake-card-sm">\ud83d\udd25 Oven <span class="pb-bake-val-sm">'+ts+'</span></div>'+
      '<div class="pb-bake-card-sm">\u23f1 Bake <span class="pb-bake-val-sm">'+cache.bake.bm+' min</span></div>'+
      '<div class="pb-bake-card-sm">\ud83c\udf21 Proof <span class="pb-bake-val-sm">'+cache.bake.pm+' min</span></div>';
    var fc=document.getElementById('f-cups'),fg=document.getElementById('f-grams');
    if(fc) fc.classList.toggle('on',mode==='cups');
    if(fg) fg.classList.toggle('on',mode==='grams');
  }

  function renderProList(mode) {
    var list=document.getElementById('pb-pro-ing-list');
    if(!list) return;
    list.innerHTML='';
    cache.results.forEach(function(ing,i){
      var amt=pShown?dispAmt(ing,mode):(mode==='grams'?toG(ing.amount,ing.unit,ing.id)+gUnit(ing.unit,ing.id):frac(roundU(ing.amount,ing.unit))+' '+ing.unit);
      var orig=pShown?dispOrig(ing,mode):null;
      var dir=ing.delta>0.005?'up':ing.delta<-0.005?'dn':'';
      var delay=pShown?i*55:0;
      var origHTML=orig?'<span class="pro-ing-orig-badge-sm '+dir+' '+(pShown?'show':'')+'" style="transition-delay:'+delay+'ms">'+orig+'</span>':'';
      list.innerHTML+='<li class="pro-ing-row-sm"><span class="pro-ing-amt-sm">'+amt+'</span><span class="pro-ing-name-sm">'+ing.name+'</span>'+origHTML+'</li>';
    });
    var bl=document.getElementById('pb-pro-bake');
    if(bl&&cache.bake){
      var ts2=mode==='grams'?'+8\u00b0C':'+15\u00b0F';
      if(pShown){bl.innerHTML='Bake <span class="pb-pro-bake-val-sm">'+cache.bake.bm+' min</span> &nbsp;\u00b7&nbsp; Proof <span class="pb-pro-bake-val-sm">'+cache.bake.pm+' min</span> &nbsp;\u00b7&nbsp; Oven <span class="pb-pro-bake-val-sm">'+ts2+'</span>';bl.classList.add('show');}
      else{bl.innerHTML='';bl.classList.remove('show');}
    }
    var status=document.getElementById('pb-pro-status');
    if(status) status.classList.toggle('show',pShown);
    var btn=document.getElementById('pb-pro-btn');
    if(btn) btn.style.display=pShown?'none':'';
    var tempStr=mode==='grams'?Math.round((375+(cache.bake?cache.bake.tf:0)-32)*5/9)+'\u00b0C':(375+(cache.bake?cache.bake.tf:0))+'\u00b0F';
    var bakeMin=32+(cache.bake?cache.bake.bm:0);
    var proofMin=90+(cache.bake?cache.bake.pm:0);
    var el=function(id){return document.getElementById(id);};
    if(pShown){
      if(el('pro-temp')) el('pro-temp').textContent=tempStr;
      if(el('pro-bake')) el('pro-bake').textContent=bakeMin+' minutes';
      if(el('pro-proof')) el('pro-proof').textContent=proofMin+' minutes';
    } else {
      if(el('pro-temp')) el('pro-temp').textContent='375\u00b0F';
      if(el('pro-bake')) el('pro-bake').textContent='32 minutes';
      if(el('pro-proof')) el('pro-proof').textContent='90 minutes';
    }
    var pc=document.getElementById('p-cups'),pg=document.getElementById('p-grams');
    if(pc) pc.classList.toggle('on',mode==='cups');
    if(pg) pg.classList.toggle('on',mode==='grams');
  }

  function populateHeader() {
    var el=function(id){return document.getElementById(id);};
    if(el('pb-loc-name')) el('pb-loc-name').textContent=cache.locName;
    if(el('pb-elev'))     el('pb-elev').textContent=cache.elevFt>=100?cache.elevFt.toLocaleString()+' ft':'Sea level';
    if(el('pb-humid'))    el('pb-humid').textContent=cache.humidity+'%';
    if(el('pb-pro-loc'))  el('pb-pro-loc').textContent=cache.locName;
    var atmoEl=document.getElementById('pb-pro-atmo');
    if(atmoEl) atmoEl.textContent='\u26f0 '+(cache.elevFt>=100?cache.elevFt.toLocaleString()+' ft':'Sea level')+' \u00b7 \ud83d\udca7 '+cache.humidity+'%';
  }

  function adjustFree() {
    var btn=document.querySelector('.pb-free-bar-btn');
    if(btn){btn.textContent='Locating\u2026';btn.disabled=true;}
    doAdjust(function(data){
      if(!data){if(btn){btn.textContent='Try again';btn.disabled=false;}return;}
      fShown=true;
      populateHeader();
      renderFreeList(fUnit);
      var bar=document.getElementById('pb-free-bar');
      var res=document.getElementById('pb-free-results');
      if(bar&&res){
        bar.style.opacity='0';bar.style.transform='translateY(-4px)';
        setTimeout(function(){
          bar.style.display='none';
          res.style.display='block';res.style.opacity='0';res.style.transform='translateY(-6px)';
          setTimeout(function(){res.style.opacity='1';res.style.transform='translateY(0)';},20);
        },180);
      }
      pShown=true;renderProList(pUnit);
    });
  }

  function adjustPro() {
    var btn=document.getElementById('pb-pro-btn');
    if(btn){btn.textContent='Locating\u2026';btn.disabled=true;}
    doAdjust(function(data){
      if(!data){if(btn){btn.textContent='Adjust for my location';btn.disabled=false;}return;}
      pShown=true;
      populateHeader();
      renderProList(pUnit);
      fShown=true;
      var bar=document.getElementById('pb-free-bar'),res=document.getElementById('pb-free-results');
      if(bar&&res&&bar.style.display!=='none'){
        renderFreeList(fUnit);
        bar.style.opacity='0';bar.style.transform='translateY(-4px)';
        setTimeout(function(){
          res.style.display='block';res.style.opacity='0';res.style.transform='translateY(-6px)';
          setTimeout(function(){res.style.opacity='1';res.style.transform='translateY(0)';},20);
        },180);
      }
    });
  }

  function resetFree() {
    fShown=false;fUnit='cups';
    var bar=document.getElementById('pb-free-bar'),res=document.getElementById('pb-free-results');
    if(res){res.style.opacity='0';setTimeout(function(){
      res.style.display='none';
      if(bar){bar.style.display='flex';bar.style.opacity='0';bar.style.transform='translateY(-4px)';
        setTimeout(function(){bar.style.opacity='1';bar.style.transform='translateY(0)';
          var b=bar.querySelector('button');if(b){b.textContent='Adjust';b.disabled=false;}
        },20);}
    },180);}
  }

  function resetPro() {
    pShown=false;pUnit='cups';
    if(cache) renderProList('cups');
    var btn=document.getElementById('pb-pro-btn');
    if(btn){btn.textContent='Adjust for my location';btn.disabled=false;}
  }

  function setFreeUnit(mode) {
    fUnit=mode;
    if(fShown&&cache) renderFreeList(mode);
    else {
      var fc=document.getElementById('f-cups'),fg=document.getElementById('f-grams');
      if(fc) fc.classList.toggle('on',mode==='cups');
      if(fg) fg.classList.toggle('on',mode==='grams');
    }
  }

  function setProUnit(mode) {
    pUnit=mode;
    if(cache) renderProList(mode);
    else {
      var pc=document.getElementById('p-cups'),pg=document.getElementById('p-grams');
      if(pc) pc.classList.toggle('on',mode==='cups');
      if(pg) pg.classList.toggle('on',mode==='grams');
    }
  }

  return {adjustFree:adjustFree,adjustPro:adjustPro,resetFree:resetFree,resetPro:resetPro,setFreeUnit:setFreeUnit,setProUnit:setProUnit};
})();
