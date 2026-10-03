export function enabled(env:NodeJS.ProcessEnv=process.env):boolean{return env.MOGS_MULTICHANNEL_ENABLED==='1'}
export function assertEnabled(env:NodeJS.ProcessEnv=process.env):void{if(!enabled(env))throw Object.assign(new Error('Multichannel lab is disabled.'),{status:404})}
