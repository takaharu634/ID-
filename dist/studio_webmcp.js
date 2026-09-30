(function(){
 'use strict';
 const context=document.modelContext;if(!context||typeof context.registerTool!=='function')return;
 const lifecycle=new AbortController();
 const register=tool=>{try{Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}};
 register({name:'read_pitch_studio_selection',description:'Read the selected season, pitcher, view and physical playback time.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute(){return {season:activeSeason.id,pitcher:current?.id||null,view,playing,time:progress*maxTime(),realism};}});
 register({name:'replay_pitch_studio_view',description:'Switch to catcher, right batter or left batter view and replay the selected real pitches.',inputSchema:{type:'object',properties:{view:{type:'string',enum:['catcher','right','left']}},required:['view'],additionalProperties:false},annotations:{readOnlyHint:false},execute(input){if(!input||Object.keys(input).length!==1||!['catcher','right','left'].includes(input.view))throw new Error('有効な視点を指定してください');if(loadingPitcher||!chosen().length)throw new Error('再生する投球がありません');switchView(input.view);return {view,playing,time:progress*maxTime()};}});
 window.addEventListener('pagehide',()=>lifecycle.abort());
})();
