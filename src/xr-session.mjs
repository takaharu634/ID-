// Device-neutral WebXR lifecycle, kept independent from the renderer for QA.
export class XRSessionFlow {
  constructor({xr,secure=true,initialize,onChange=()=>{},onEnd=()=>{},onVisibility=()=>{}}) {
    Object.assign(this,{xr,secure,initialize,onChange,onEnd,onVisibility});this.state='idle';this.session=null;this.supported=false;
  }
  async probe() {
    if(!this.secure||!this.xr){this.supported=false;this.onChange('unsupported');return false;}
    try{this.supported=await this.xr.isSessionSupported('immersive-vr');this.onChange(this.supported?'ready':'unsupported');return this.supported;}
    catch{this.supported=false;this.onChange('unsupported');return false;}
  }
  async enter() {
    if(this.state!=='idle'||!this.supported)return false;
    this.state='starting';this.onChange('starting');
    let session=null, ended=false;
    const finish=()=>{if(ended)return;ended=true;session?.removeEventListener('end',finish);session?.removeEventListener('visibilitychange',visibility);this.session=null;this.state='idle';this.onEnd();this.onChange(this.supported?'ready':'unsupported');};
    const visibility=()=>this.onVisibility(session?.visibilityState==='visible');
    try{
      // Called directly from a user click, before any asynchronous work.
      session=await this.xr.requestSession('immersive-vr',{optionalFeatures:['local-floor','bounded-floor']});
      this.session=session;session.addEventListener('end',finish);session.addEventListener('visibilitychange',visibility);
      let floor=true;
      try{await session.requestReferenceSpace('local-floor');}catch{floor=false;await session.requestReferenceSpace('local');}
      if(ended)return false;
      await this.initialize(session,floor);
      if(ended)return false;
      this.state='active';this.onChange('active');return true;
    }catch(error){
      if(session&&!ended){try{await session.end();}catch{finish();}}
      if(!ended)finish();this.onChange('error',error);return false;
    }
  }
  async exit(){if(this.session){try{await this.session.end();}catch(error){this.onChange('error',error);}}}
}
