import { InstanceBase, InstanceStatus, runEntrypoint, combineRgb, type CompanionActionDefinitions, type CompanionFeedbackDefinitions, type CompanionVariableDefinition, type SomeCompanionConfigField } from '@companion-module/base'
import * as net from 'net'

interface Config { host: string; port: number; password: string }

export default class MuraDVWInstance extends InstanceBase<Config> {
  private socket?: net.Socket
  private rx = Buffer.alloc(0)
  private telnetState = 0
  private iacCommand = 0

  async init(config: Config): Promise<void> { this.config = config; this.initActions(); this.initFeedbacks(); this.initVariables(); await this.connect() }
  async destroy(): Promise<void> { this.socket?.destroy(); this.socket = undefined }
  async configUpdated(config: Config): Promise<void> { this.config = config; this.socket?.destroy(); await this.connect() }

  getConfigFields(): SomeCompanionConfigField[] { return [
    {type:'textinput',id:'host',label:'Mura IP address',width:6,default:'10.3.128.123'},
    {type:'number',id:'port',label:'TCP port',width:3,default:23,min:1,max:65535},
    {type:'textinput',id:'password',label:'Password (optional)',width:6,default:'',password:true}
  ] }

  private connect(): Promise<void> { return new Promise(resolve => {
    const s = new net.Socket(); this.socket=s; this.rx=Buffer.alloc(0); this.telnetState=0
    s.setTimeout(8000)
    s.on('connect',()=>{this.updateStatus(InstanceStatus.Ok); resolve()})
    s.on('data',d=>this.handleData(d))
    s.on('error',()=>{this.updateStatus(InstanceStatus.ConnectionFailure); resolve()})
    s.on('close',()=>{if(this.socket===s)this.updateStatus(InstanceStatus.Disconnected)})
    s.connect(Number(this.config.port)||23,this.config.host)
  }) }

  private handleData(data: Buffer) {
    const out:number[]=[]
    for (const b of data) {
      if(this.telnetState===1){ if(b===255){this.telnetState=2}else{this.telnetState=0;out.push(b)}; continue }
      if(this.telnetState===2){ if(b===255){out.push(255);this.telnetState=0;continue}; this.iacCommand=b; this.telnetState=3; continue }
      if(this.telnetState===3){ const cmd=this.iacCommand; if(cmd===251||cmd===252)this.socket?.write(Buffer.from([255,254,b])); else if(cmd===253||cmd===254)this.socket?.write(Buffer.from([255,252,b])); this.telnetState=0; continue }
      if(b===255){this.telnetState=1}else out.push(b)
    }
    if(out.length) { this.rx=Buffer.concat([this.rx,Buffer.from(out)]); let i; while((i=this.rx.indexOf(10))>=0){const line=this.rx.subarray(0,i+1).toString('utf8').replace(/[\r\n]+$/,''); this.rx=this.rx.subarray(i+1); this.processLine(line)} }
  }

  private processLine(line:string){
    const m=line.match(/([A-Za-z][A-Za-z0-9_]*):\s*([^,\r\n]*)/g); if(m){for(const part of m){const p=part.indexOf(':');this.setVariableValues({[this.key(part.slice(0,p))]:part.slice(p+1).trim()})}} this.setVariableValues({last_result:line}) }
  private key(k:string){return ({Appliance:'appliance',State:'state',CurrentLayout:'current_layout',CPUUsage:'cpu_usage',APILevel:'api_level',Scheduler:'scheduler',SystemTime:'system_time'} as any)[k] || k.toLowerCase()}
  private sendCommand(cmd:string){ if(!this.socket || this.socket.destroyed){this.connect().then(()=>this.socket?.write(cmd.replace(/[\r\n]*$/,'')+'\r\n'));return} this.socket.write(cmd.replace(/[\r\n]*$/,'')+'\r\n') }

  private initActions(){ const actions:CompanionActionDefinitions={
    status:{name:'Status',options:[],callback:async()=>this.sendCommand('Status')},
    layout:{name:'Apply Layout',options:[{type:'textinput',id:'layout',label:'Layout name',default:'Layout 1'}],callback:async a=>this.sendCommand(`ApplyLayout "${String(a.options.layout)}"`)},
    raw:{name:'Raw Command',options:[{type:'textinput',id:'command',label:'Command',default:'Status'}],callback:async a=>this.sendCommand(String(a.options.command))},
    reconnect:{name:'Reconnect Mura',options:[],callback:async()=>{this.socket?.destroy();await this.connect()}}
  }; this.setActionDefinitions(actions) }
  private initFeedbacks(){ this.setFeedbackDefinitions({connected:{type:'boolean',name:'Connected',defaultStyle:{bgcolor:combineRgb(0,180,0)},options:{},callback:()=>this.socket?.readyState===net.Socket.OPEN}} as CompanionFeedbackDefinitions) }
  private initVariables(){ const v:CompanionVariableDefinition[]=['connection','appliance','state','current_layout','cpu_usage','api_level','scheduler','system_time','last_result'].map(name=>({name,label:name})); this.setVariableDefinitions(v); this.setVariableValues({connection:'disconnected'}) }
}

runEntrypoint(MuraDVWInstance, [])
