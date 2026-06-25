// ── Pixel helpers ─────────────────────────────────────────────────────
function clamp(v,lo,hi){return v<lo?lo:v>hi?hi:v;}
function getPixel(data,W,H,x,y){x=clamp(x,0,W-1);y=clamp(y,0,H-1);const i=(y*W+x)*4;return[data[i],data[i+1],data[i+2]];}
function setPixel(data,W,H,x,y,r,g,b,a=255){if(x<0||x>=W||y<0||y>=H)return;const i=(y*W+x)*4;data[i]=r;data[i+1]=g;data[i+2]=b;data[i+3]=a;}
function avgBlock(data,W,H,bx,by,ps){
  let r=0,g=0,b=0,n=0;
  for(let dy=0;dy<ps;dy++)for(let dx=0;dx<ps;dx++){const[pr,pg,pb]=getPixel(data,W,H,bx+dx,by+dy);r+=pr;g+=pg;b+=pb;n++;}
  return[Math.round(r/n),Math.round(g/n),Math.round(b/n)];
}
function fillBlock(data,W,H,bx,by,ps,r,g,b,a=255){for(let dy=0;dy<ps;dy++)for(let dx=0;dx<ps;dx++)setPixel(data,W,H,bx+dx,by+dy,r,g,b,a);}

// ── Color conversion ──────────────────────────────────────────────────
function hexRgb(hex){
  const h=hex.replace('#','');
  return[parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)];
}
function rgbHex(r,g,b){
  return'#'+[r,g,b].map(v=>clamp(Math.round(v),0,255).toString(16).padStart(2,'0')).join('').toUpperCase();
}

// ── Color-state-aware helpers (reference globals from app.js) ─────────
function c1rgb(){return hexRgb(color1);}
function c2rgb(){return hexRgb(color2);}
function writeC1(data,W,H,x,y){if(c1Transp)return;const[r,g,b]=c1rgb();setPixel(data,W,H,x,y,r,g,b,c1Alpha);}
function writeC2(data,W,H,x,y){if(c2Transp)return;const[r,g,b]=c2rgb();setPixel(data,W,H,x,y,r,g,b,c2Alpha);}
function fillC1(data,W,H,bx,by,ps){if(c1Transp)return;const[r,g,b]=c1rgb();fillBlock(data,W,H,bx,by,ps,r,g,b,c1Alpha);}
function fillC2(data,W,H,bx,by,ps){if(c2Transp)return;const[r,g,b]=c2rgb();fillBlock(data,W,H,bx,by,ps,r,g,b,c2Alpha);}

// ── Dither helpers ────────────────────────────────────────────────────
const BAYER_MX = {
  2:[[0,2],[3,1]],
  4:[[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]],
  8:[
    [ 0,32, 8,40, 2,34,10,42],
    [48,16,56,24,50,18,58,26],
    [12,44, 4,36,14,46, 6,38],
    [60,28,52,20,62,30,54,22],
    [ 3,35,11,43, 1,33, 9,41],
    [51,19,59,27,49,17,57,25],
    [15,47, 7,39,13,45, 5,37],
    [63,31,55,23,61,29,53,21],
  ],
};
function quantLum(v,levels){const step=255/(levels-1);return Math.round(clamp(Math.round(v/step),0,levels-1)*step);}

function makeBlockGrid(srcData,W,H,blocks,ps){
  let gx0=Infinity,gy0=Infinity,gx1=-Infinity,gy1=-Infinity;
  blocks.forEach(({bx,by})=>{
    const gx=bx/ps,gy=by/ps;
    if(gx<gx0)gx0=gx;if(gy<gy0)gy0=gy;if(gx>gx1)gx1=gx;if(gy>gy1)gy1=gy;
  });
  const GW=gx1-gx0+1,GH=gy1-gy0+1;
  const lums=new Float32Array(GW*GH);
  const mask=new Uint8Array(GW*GH);
  blocks.forEach(({bx,by})=>{
    const gx=bx/ps-gx0,gy=by/ps-gy0;
    const[r,g,b]=avgBlock(srcData,W,H,bx,by,ps);
    lums[gy*GW+gx]=0.299*r+0.587*g+0.114*b;
    mask[gy*GW+gx]=1;
  });
  return{gx0,gy0,GW,GH,lums,mask};
}

function ditherBlock(data,W,H,bx,by,ps,qLum,levels){
  const t=qLum/255;
  if(levels<=2){
    if(t>0.5) fillC1(data,W,H,bx,by,ps);
    else      fillC2(data,W,H,bx,by,ps);
  } else {
    if(c1Transp&&c2Transp)return;
    if(c1Transp)        { fillC2(data,W,H,bx,by,ps); return; }
    if(c2Transp)        { fillC1(data,W,H,bx,by,ps); return; }
    const[r1,g1,b1]=c1rgb();
    const[r2,g2,b2]=c2rgb();
    const r=Math.round(r2+(r1-r2)*t);
    const g=Math.round(g2+(g1-g2)*t);
    const b=Math.round(b2+(b1-b2)*t);
    const a=Math.round(c2Alpha+(c1Alpha-c2Alpha)*t);
    fillBlock(data,W,H,bx,by,ps,r,g,b,a);
  }
}

// ── Effects ───────────────────────────────────────────────────────────
const FX = {

  pixelate(data,W,H,blocks,ps){
    const[c1r,c1g,c1b]=c1rgb();
    const chaos=val('chaos')/100;
    blocks.forEach(({bx,by})=>{
      let[r,g,b]=avgBlock(data,W,H,bx,by,ps);
      if(chaos>0){const j=chaos*80;r=clamp(r+(Math.random()-.5)*j,0,255);g=clamp(g+(Math.random()-.5)*j,0,255);b=clamp(b+(Math.random()-.5)*j,0,255);}
      if(Math.random()<chaos*.2&&!c1Transp){r=c1r;g=c1g;b=c1b;}
      fillBlock(data,W,H,bx,by,ps,r,g,b);
    });
  },

  shuffle(data,W,H,blocks,ps){
    const chaos=val('chaos')/100;
    const snaps=blocks.map(({bx,by})=>{
      const px=[];
      for(let row=0;row<ps;row++)for(let col=0;col<ps;col++)px.push(...getPixel(data,W,H,bx+col,by+row),255);
      return px;
    });
    for(let i=snaps.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[snaps[i],snaps[j]]=[snaps[j],snaps[i]];}
    snaps.forEach((px,idx)=>{
      const{bx,by}=blocks[idx];let k=0;
      for(let row=0;row<ps;row++)for(let col=0;col<ps;col++){setPixel(data,W,H,bx+col,by+row,px[k],px[k+1],px[k+2]);k+=4;}
    });
    if(chaos>0.2){
      const extra=Math.floor(chaos*blocks.length*.4);
      for(let i=0;i<extra;i++){
        const src=blocks[Math.floor(Math.random()*blocks.length)];
        const dst=blocks[Math.floor(Math.random()*blocks.length)];
        const tmp=[];
        for(let r=0;r<ps;r++)for(let c=0;c<ps;c++)tmp.push(...getPixel(data,W,H,src.bx+c,src.by+r));
        let k=0;for(let r=0;r<ps;r++)for(let c=0;c<ps;c++){setPixel(data,W,H,dst.bx+c,dst.by+r,tmp[k],tmp[k+1],tmp[k+2]);k+=3;}
      }
    }
  },

  scatter(data,W,H,blocks,ps){
    const intensity=val('intensity')/100;
    const chaos=val('chaos')/100;
    const density=val('density');
    const[r,g,b]=c1rgb();
    blocks.forEach(({bx,by})=>{
      if(Math.random()>intensity)return;
      for(let d=0;d<density;d++){
        if(c1Transp)break;
        const sx=Math.floor(Math.random()*ps);
        const sy=Math.floor(Math.random()*ps);
        const sw=Math.max(1,Math.floor(ps*(.1+Math.random()*.9*chaos)));
        const sh=Math.max(1,Math.floor(ps*(.1+Math.random()*.9*chaos)));
        for(let dy=0;dy<sh;dy++)for(let dx=0;dx<sw;dx++)setPixel(data,W,H,bx+sx+dx,by+sy+dy,r,g,b,c1Alpha);
      }
    });
  },

  glitch(data,W,H,blocks,ps){
    const intensity=val('intensity')/100;
    const chaos=val('chaos')/100;
    const streakMult=val('streak')/50;
    blocks.forEach(({bx,by})=>{
      if(Math.random()>intensity)return;
      const maxShift=Math.round(ps*(1+chaos*6)*streakMult);
      const shiftX=Math.round((Math.random()-.5)*2*maxShift);
      const shiftY=chaos>.5&&Math.random()<.3?Math.round((Math.random()-.5)*maxShift*.5):0;
      for(let row=0;row<ps;row++){
        const y=by+row;if(y<0||y>=H)continue;
        const buf=[];
        for(let col=0;col<ps;col++)buf.push(...getPixel(data,W,H,clamp(bx+col+shiftX,0,W-1),clamp(y+shiftY,0,H-1)));
        let k=0;for(let col=0;col<ps;col++){setPixel(data,W,H,bx+col,y,buf[k],buf[k+1],buf[k+2]);k+=3;}
      }
    });
  },

  checker(data,W,H,blocks,ps){
    const chaos=val('chaos')/100;
    blocks.forEach(({bx,by})=>{
      const sub=Math.max(1,Math.round(ps/(2+Math.round(chaos*4))));
      for(let row=0;row<ps;row++){
        for(let col=0;col<ps;col++){
          const ri=Math.floor(row/sub),ci=Math.floor(col/sub);
          if((ri+ci)%2===0) writeC1(data,W,H,bx+col,by+row);
          else              writeC2(data,W,H,bx+col,by+row);
        }
      }
    });
  },

  dissolve(data,W,H,blocks,ps){
    const intensity=val('intensity')/100;
    const chaos=val('chaos')/100;
    blocks.forEach(({bx,by})=>{
      if(Math.random()>intensity)return;
      const sx=Math.floor(Math.random()*(W-ps));
      const sy=Math.floor(Math.random()*(H-ps));
      for(let row=0;row<ps;row++)for(let col=0;col<ps;col++)
        if(Math.random()<.4+chaos*.6){const[r,g,b]=getPixel(data,W,H,sx+col,sy+row);setPixel(data,W,H,bx+col,by+row,r,g,b);}
    });
  },

  colorBlock(data,W,H,blocks,ps){
    const intensity=val('intensity')/100;
    const chaos=val('chaos')/100;
    const density=val('density');
    if(c1Transp)return;
    const[r,g,b]=c1rgb();
    blocks.forEach(({bx,by})=>{
      if(Math.random()>intensity)return;
      for(let d=0;d<density;d++){
        const bw=Math.max(2,Math.round(ps*(.2+Math.random()*.8)));
        const bh=Math.max(2,Math.round(ps*(.2+Math.random()*.8)));
        const ox=Math.floor(Math.random()*(ps-bw+1));
        const oy=Math.floor(Math.random()*(ps-bh+1));
        for(let row=0;row<bh;row++)for(let col=0;col<bw;col++)setPixel(data,W,H,bx+ox+col,by+oy+row,r,g,b,c1Alpha);
      }
    });
  },

  mosaic(data,W,H,blocks,ps){
    const chaos=val('chaos')/100;
    const[c1r,c1g,c1b]=c1rgb();
    const visited=new Set();
    blocks.forEach(({bx,by})=>{
      const key=`${bx},${by}`;if(visited.has(key))return;
      const cw=1+Math.floor(Math.random()*(1+chaos*4));
      const ch=1+Math.floor(Math.random()*(1+chaos*4));
      let r=0,g=0,b=0,n=0;
      for(let cy=0;cy<ch;cy++)for(let cx=0;cx<cw;cx++){
        visited.add(`${bx+cx*ps},${by+cy*ps}`);
        const[pr,pg,pb]=avgBlock(data,W,H,bx+cx*ps,by+cy*ps,ps);r+=pr;g+=pg;b+=pb;n++;
      }
      r=Math.round(r/n);g=Math.round(g/n);b=Math.round(b/n);
      if(Math.random()<chaos*.15&&!c1Transp){r=c1r;g=c1g;b=c1b;}
      for(let cy=0;cy<ch;cy++)for(let cx=0;cx<cw;cx++)fillBlock(data,W,H,bx+cx*ps,by+cy*ps,ps,r,g,b);
    });
  },

  corrupt(data,W,H,blocks,ps){
    const intensity=val('intensity')/100;
    const chaos=val('chaos')/100;
    const streakMult=val('streak')/50;
    const density=val('density');
    const[r,g,b]=c1rgb();
    blocks.forEach(({bx,by})=>{
      if(Math.random()>intensity)return;
      for(let d=0;d<density;d++){
        const row=by+Math.floor(Math.random()*ps);
        const len=Math.round(ps*(1+chaos*8)*streakMult);
        const useC1=Math.random()<.6;
        for(let dx=0;dx<len;dx++){
          const x=bx+dx;
          if(useC1&&!c1Transp) setPixel(data,W,H,x,row,r,g,b,c1Alpha);
          else{const v=Math.random()<.5?0:255;setPixel(data,W,H,x,row,v,v,v);}
        }
        if(chaos>.3&&Math.random()<chaos*.5){
          const col=bx+Math.floor(Math.random()*ps);
          const vlen=Math.round(ps*(1+chaos*4)*streakMult);
          for(let dy=0;dy<vlen;dy++){
            if(!c1Transp) setPixel(data,W,H,col,by+dy,r,g,b,c1Alpha);
          }
        }
        const nCount=Math.floor(chaos*8);
        for(let n=0;n<nCount;n++){
          const nx=bx+Math.floor(Math.random()*ps);
          const ny=by+Math.floor(Math.random()*ps);
          const[pr,pg,pb]=getPixel(data,W,H,nx,ny);
          setPixel(data,W,H,nx,ny,
            pr^(1<<Math.floor(Math.random()*8)),
            pg^(1<<Math.floor(Math.random()*8)),
            pb^(1<<Math.floor(Math.random()*8)));
        }
      }
    });
  },

  ditherBayer(data,W,H,blocks,ps){
    const thr=val('threshold');
    const levels=val('levels');
    const chaos=val('chaos')/100;
    const mx=BAYER_MX[bayerSize];
    const mSz=bayerSize;
    const mMax=mSz*mSz;
    const step=255/(levels-1);
    const src=(ditherSrc==='orig'?(origData||data):data);
    blocks.forEach(({bx,by})=>{
      const gx=Math.round(bx/ps), gy=Math.round(by/ps);
      const[r,g,b]=avgBlock(src,W,H,bx,by,ps);
      const lum=0.299*r+0.587*g+0.114*b+(thr-127);
      const sig=(mx[gy%mSz][gx%mSz]/mMax-.5)*step+(Math.random()-.5)*chaos*step*.8;
      const qLum=quantLum(lum+sig,levels);
      ditherBlock(data,W,H,bx,by,ps,qLum,levels);
    });
  },

  ditherFS(data,W,H,blocks,ps){
    const thr=val('threshold');
    const spread=val('spread')/100;
    const levels=val('levels');
    const chaos=val('chaos')/100;
    const step=255/(levels-1);
    const{gx0,gy0,GW,GH,lums,mask}=makeBlockGrid((ditherSrc==='orig'?(origData||data):data),W,H,blocks,ps);
    for(let i=0;i<lums.length;i++)if(mask[i])lums[i]+=(thr-127)+(Math.random()-.5)*chaos*step*.5;
    for(let gy=0;gy<GH;gy++){
      for(let gx=0;gx<GW;gx++){
        if(!mask[gy*GW+gx])continue;
        const old=lums[gy*GW+gx];
        const qLum=quantLum(old,levels);
        const err=(old-qLum)*spread;
        lums[gy*GW+gx]=qLum;
        if(gx+1<GW)        lums[ gy   *GW+gx+1]+=err*7/16;
        if(gy+1<GH){
          if(gx-1>=0)      lums[(gy+1)*GW+gx-1]+=err*3/16;
                            lums[(gy+1)*GW+gx  ]+=err*5/16;
          if(gx+1<GW)      lums[(gy+1)*GW+gx+1]+=err*1/16;
        }
      }
    }
    for(let gy=0;gy<GH;gy++)for(let gx=0;gx<GW;gx++){
      if(!mask[gy*GW+gx])continue;
      ditherBlock(data,W,H,(gx0+gx)*ps,(gy0+gy)*ps,ps,clamp(lums[gy*GW+gx],0,255),levels);
    }
  },

  ditherAtk(data,W,H,blocks,ps){
    const thr=val('threshold');
    const spread=val('spread')/100;
    const levels=val('levels');
    const chaos=val('chaos')/100;
    const step=255/(levels-1);
    const{gx0,gy0,GW,GH,lums,mask}=makeBlockGrid((ditherSrc==='orig'?(origData||data):data),W,H,blocks,ps);
    for(let i=0;i<lums.length;i++)if(mask[i])lums[i]+=(thr-127)+(Math.random()-.5)*chaos*step*.4;
    for(let gy=0;gy<GH;gy++){
      for(let gx=0;gx<GW;gx++){
        if(!mask[gy*GW+gx])continue;
        const old=lums[gy*GW+gx];
        const qLum=quantLum(old,levels);
        const e=(old-qLum)*spread/8;
        lums[gy*GW+gx]=qLum;
        [[gx+1,gy],[gx+2,gy],[gx-1,gy+1],[gx,gy+1],[gx+1,gy+1],[gx,gy+2]].forEach(([nx,ny])=>{
          if(nx>=0&&nx<GW&&ny>=0&&ny<GH)lums[ny*GW+nx]+=e;
        });
      }
    }
    for(let gy=0;gy<GH;gy++)for(let gx=0;gx<GW;gx++){
      if(!mask[gy*GW+gx])continue;
      ditherBlock(data,W,H,(gx0+gx)*ps,(gy0+gy)*ps,ps,clamp(lums[gy*GW+gx],0,255),levels);
    }
  },

  ditherHT(data,W,H,blocks,ps){
    const thr=val('threshold');
    const levels=val('levels');
    const chaos=val('chaos')/100;
    const half=ps/2;
    const src=(ditherSrc==='orig'?(origData||data):data);
    blocks.forEach(({bx,by})=>{
      const[r,g,b]=avgBlock(src,W,H,bx,by,ps);
      const lum=clamp(0.299*r+0.587*g+0.114*b+(thr-127),0,255);
      const darkness=1-lum/255;
      const qDark=quantLum(darkness*255,levels)/255;
      const dotR=half*qDark+(Math.random()-.5)*chaos*half*.5;
      const cx=bx+half,cy=by+half;
      for(let row=0;row<ps;row++){
        for(let col=0;col<ps;col++){
          const dx=bx+col-cx+.5,dy=by+row-cy+.5;
          let inside=false;
          if(htShape==='circle')  inside=Math.hypot(dx,dy)<=dotR;
          else if(htShape==='square') inside=Math.abs(dx)<=dotR&&Math.abs(dy)<=dotR;
          else if(htShape==='diamond')inside=Math.abs(dx)+Math.abs(dy)<=dotR*1.41;
          else if(htShape==='lines'){const gap=Math.max(1,Math.round(half/(dotR+.01)));inside=(row%gap)===0;}
          if(inside) writeC1(data,W,H,bx+col,by+row);
          else        writeC2(data,W,H,bx+col,by+row);
        }
      }
    });
  },

  erase(data,W,H,blocks,ps){
    blocks.forEach(({bx,by})=>{
      for(let row=0;row<ps;row++)for(let col=0;col<ps;col++){
        const x=bx+col,y=by+row;
        if(x<0||x>=W||y<0||y>=H)continue;
        const i=(y*W+x)*4;
        data[i]=origData[i];data[i+1]=origData[i+1];data[i+2]=origData[i+2];data[i+3]=origData[i+3];
      }
    });
  },
};

// ── Color erase ───────────────────────────────────────────────────────
function doColorErase(cx,cy){
  const W=canvas.width,H=canvas.height;
  const data=workData.data;
  const[sr,sg,sb]=getPixel(data,W,H,cx,cy);
  const tol=val('tolerance');
  const maxDist=442;
  const thresh=tol/100*maxDist;
  const thresh2=thresh*thresh;
  for(let i=0;i<data.length;i+=4){
    if(data[i+3]===0)continue;
    const dr=data[i]-sr,dg=data[i+1]-sg,db=data[i+2]-sb;
    if(dr*dr+dg*dg+db*db<=thresh2) data[i+3]=0;
  }
  ctx.putImageData(workData,0,0);
}
