import { createCosmicBackground, type CosmicBackground } from './background';
import { inverseSpacePoint, RIPPLE_LIFETIME, sampleSpaceField, type SpaceRipple } from './field';
import { createEnergyNodeRenderer, type EnergyNode } from './nodes';

export type { EnergyNode } from './nodes';
export interface CinematicSettings {
  background: 'web' | 'deep'; quality: 'high' | 'medium' | 'low';
  effects: boolean; glow: number; particles: number; distortion: number; folds: number;
}
export const DEFAULT_CINEMATIC_SETTINGS: CinematicSettings = {
  background:'web', quality:'high', effects:true, glow:1, particles:0.8, distortion:0.85, folds:0.8,
};
const clamp = (n:number,lo:number,hi:number) => Math.max(lo,Math.min(hi,n));

/** Paint-only world-space layer. No RAF, keyboard handlers, or simulation writes. */
export function createCinematicSpace(worldWidth:number,worldHeight:number,seed=1701) {
  const backgrounds = new Map<string,CosmicBackground>();
  const energy = createEnergyNodeRenderer(seed);
  const ripples:SpaceRipple[] = [];
  const lastState = new Map<string,{active:boolean;strength:number;time:number}>();
  const warped = document.createElement('canvas');
  const wc = warped.getContext('2d',{alpha:false})!;
  const working = document.createElement('canvas');
  const bc = working.getContext('2d',{willReadFrequently:true,alpha:false})!;
  let base:ImageData|undefined, output:ImageData|undefined;
  let cacheKey='', lastWarp=-Infinity, disposed=false, renderMs=0;
  const field = {dx:0,dy:0,shade:0}, inverse = {x:0,y:0};
  function background(mode:'web'|'deep') {
    let bg=backgrounds.get(mode);
    if(!bg) {bg=createCosmicBackground(seed,worldWidth,worldHeight,mode);backgrounds.set(mode,bg);}
    return bg;
  }
  function pulse(node:EnergyNode,time:number,strength=0.85) {
    if(disposed) return;
    ripples.push({x:node.x,y:node.y,startedAt:time,strength,kind:node.kind});
    if(ripples.length>8) ripples.splice(0,ripples.length-8);
  }
  function observe(nodes:readonly EnergyNode[],time:number) {
    for(let i=ripples.length-1;i>=0;i--) if(time-ripples[i].startedAt>=RIPPLE_LIFETIME||time<ripples[i].startedAt) ripples.splice(i,1);
    for(const node of nodes) {
      const before=lastState.get(node.id);
      if(before&&(before.active!==node.active||(node.active&&Math.abs(before.strength-node.strength)>0.18))&&time-before.time>0.18) {
        pulse(node,time,node.active?1:0.4);before.time=time;
      }
      lastState.set(node.id,{active:node.active,strength:node.strength,time:before?.time??-Infinity});
    }
  }
  function updateTexture(bg:CosmicBackground,nodes:readonly EnergyNode[],time:number,settings:CinematicSettings) {
    const width=settings.quality==='high'?1024:settings.quality==='medium'?768:512;
    const height=Math.round(width*worldHeight/worldWidth), key=settings.background+':'+width;
    if(key!==cacheKey) {
      cacheKey=key;working.width=warped.width=width;working.height=warped.height=height;
      bc.drawImage(bg.texture,0,0,width,height);base=bc.getImageData(0,0,width,height);
      output=wc.createImageData(width,height);lastWarp=-Infinity;
    }
    if(time-lastWarp<1/(settings.quality==='low'?16:30)) return;
    lastWarp=time;const start=performance.now(),source=base!.data,target=output!.data;
    target.set(source);
    const sx=width/worldWidth,sy=height/worldHeight,step=12;
    const cols=Math.ceil(width/step)+1,rows=Math.ceil(height/step)+1,grid=new Float32Array(cols*rows*3);
    // Fixed WORLD grid: the camera never participates in texture sampling.
    for(let gy=0;gy<rows;gy++) for(let gx=0;gx<cols;gx++) {
      const x=gx*step/sx,y=gy*step/sy;
      inverseSpacePoint(x,y,nodes,ripples,time,settings.distortion,inverse);
      sampleSpaceField(inverse.x,inverse.y,nodes,ripples,time,settings.distortion,field);
      const i=(gy*cols+gx)*3;
      grid[i]=(inverse.x-x)*sx;grid[i+1]=(inverse.y-y)*sy;
      const organic=0.68+0.21*Math.sin(inverse.x*0.025+Math.sin(inverse.y*0.014)*2)+0.11*Math.sin(inverse.y*0.051-inverse.x*0.019);
      grid[i+2]=field.shade*organic*settings.folds*2.1;
    }
    for(let gy=0;gy<rows-1;gy++) for(let gx=0;gx<cols-1;gx++) {
      const a=(gy*cols+gx)*3,b=a+3,c=a+cols*3,d=c+3;
      if(Math.abs(grid[a])+Math.abs(grid[a+1])+Math.abs(grid[b])+Math.abs(grid[b+1])+Math.abs(grid[c])+Math.abs(grid[c+1])+Math.abs(grid[d])+Math.abs(grid[d+1])<0.0001
        &&Math.abs(grid[a+2])+Math.abs(grid[b+2])+Math.abs(grid[c+2])+Math.abs(grid[d+2])<0.0001) continue;
      const yEnd=Math.min(height,(gy+1)*step),xEnd=Math.min(width,(gx+1)*step);
      for(let y=gy*step;y<yEnd;y++) {
        const v=(y-gy*step)/step,lx=grid[a]+(grid[c]-grid[a])*v,rx=grid[b]+(grid[d]-grid[b])*v;
        const ly=grid[a+1]+(grid[c+1]-grid[a+1])*v,ry=grid[b+1]+(grid[d+1]-grid[b+1])*v;
        const ls=grid[a+2]+(grid[c+2]-grid[a+2])*v,rs=grid[b+2]+(grid[d+2]-grid[b+2])*v;
        for(let x=gx*step;x<xEnd;x++) {
          const u=(x-gx*step)/step,px=clamp(x+lx+(rx-lx)*u,0,width-1.001),py=clamp(y+ly+(ry-ly)*u,0,height-1.001);
          const ix=Math.floor(px),iy=Math.floor(py),fx=px-ix,fy=py-iy,s=(iy*width+ix)*4,t=(y*width+x)*4,light=1+ls+(rs-ls)*u;
          for(let ch=0;ch<3;ch++) {
            const top=source[s+ch]*(1-fx)+source[s+4+ch]*fx,bottom=source[s+width*4+ch]*(1-fx)+source[s+width*4+4+ch]*fx;
            target[t+ch]=clamp((top*(1-fy)+bottom*fy)*light,0,255);
          }
        }
      }
    }
    wc.putImageData(output!,0,0);renderMs=performance.now()-start;
  }
  return {
    pulse,
    drawBackground(ctx:CanvasRenderingContext2D,nodes:readonly EnergyNode[],time:number,settings:CinematicSettings) {
      if(disposed) return;
      observe(nodes,time);const bg=background(settings.background);
      const active=settings.effects&&settings.distortion>0&&(nodes.some(n=>n.active&&n.strength>0)||ripples.length>0);
      ctx.save();ctx.globalCompositeOperation='source-over';ctx.globalAlpha=1;ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
      if(active) {updateTexture(bg,nodes,time,settings);ctx.drawImage(warped,0,0,worldWidth,worldHeight);}
      else {ctx.drawImage(bg.texture,0,0,worldWidth,worldHeight);lastWarp=-Infinity;}
      ctx.globalCompositeOperation='screen';
      for(const star of bg.stars) {
        let x=star.x,y=star.y,shade=0;
        if(active) {sampleSpaceField(x,y,nodes,ripples,time,settings.distortion,field);x+=field.dx;y+=field.dy;shade=field.shade;}
        const cold=star.temperature,alpha=clamp(star.alpha*(0.93+Math.sin(time*0.35+star.phase)*0.07)*(1+shade),0,1);
        ctx.fillStyle='rgba('+Math.round(248-cold*53)+','+Math.round(214+cold*22)+','+Math.round(174+cold*81)+','+alpha+')';
        ctx.beginPath();ctx.arc(x,y,star.radius,0,Math.PI*2);ctx.fill();
        if(star.radius>1.6&&star.alpha>0.62) {
          const g=ctx.createRadialGradient(x,y,0,x,y,star.radius*5);
          g.addColorStop(0,'rgba(177,207,255,'+alpha*0.26+')');g.addColorStop(1,'rgba(105,150,255,0)');
          ctx.fillStyle=g;ctx.fillRect(x-star.radius*5,y-star.radius*5,star.radius*10,star.radius*10);
        }
      }
      ctx.restore();
    },
    drawNodes(ctx:CanvasRenderingContext2D,nodes:readonly EnergyNode[],time:number,dt:number,settings:CinematicSettings) {
      if(!disposed) for(const node of nodes) energy.draw(ctx,node,time,dt,settings);
    },
    get diagnostics() {return {warpMs:renderMs,waves:ripples.length,cachedBackgrounds:backgrounds.size};},
    reset() {ripples.length=0;lastState.clear();lastWarp=-Infinity;energy.reset();},
    dispose() {disposed=true;energy.dispose();backgrounds.clear();ripples.length=0;lastState.clear();base=undefined;output=undefined;working.width=warped.width=1;},
  };
}
