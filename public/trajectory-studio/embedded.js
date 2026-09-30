(function(){
 'use strict';
 const params=new URLSearchParams(window.location.search),embedded=params.get('embedded')==='1';
 const requested=params.get('season'),season=/^[1-9]\d{3}-(spring|fall)$/.test(requested||'')?requested:null;
 if(embedded)document.documentElement.classList.add('embeddedStudio');
 let notified=false;
 window.StudioIntegration={season,ready(activeSeason){
  if(notified||!embedded||window.parent===window)return;
  notified=true;
  window.parent.postMessage({type:'id-touto-trajectory-ready',season:activeSeason},window.location.origin);
 }};
})();
