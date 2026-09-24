import * as THREE from 'three';

/** Procedural canvas textures – the game ships without image files. */

function canvasTex(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, repeat = false): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
  }
  return t;
}

function rng(seed: number): () => number {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
}

let cache: ReturnType<typeof build> | null = null;

function build() {
  const soft = canvasTex(64, 64, (ctx) => {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.65)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  });
  const smoke = canvasTex(64, 64, (ctx) => {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,0.8)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.3)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  });
  const ring = canvasTex(128, 128, (ctx) => {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(64, 64, 56, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 16;
    ctx.stroke();
  });
  // concrete yard slabs with seams, cracks and oil stains
  const ground = canvasTex(
    512,
    512,
    (ctx) => {
      const r = rng(1337);
      ctx.fillStyle = '#7d7b76';
      ctx.fillRect(0, 0, 512, 512);
      // slab tone variation
      for (let y = 0; y < 4; y++)
        for (let x = 0; x < 4; x++) {
          const v = Math.floor((r() - 0.5) * 16);
          ctx.fillStyle = `rgba(${120 + v},${118 + v},${112 + v},0.35)`;
          ctx.fillRect(x * 128, y * 128, 128, 128);
        }
      for (let i = 0; i < 9000; i++) {
        const v = 90 + Math.floor(r() * 70);
        ctx.fillStyle = `rgba(${v},${v - 2},${v - 6},${0.15 + r() * 0.3})`;
        ctx.fillRect(r() * 512, r() * 512, 1 + r() * 2, 1 + r() * 2);
      }
      for (let i = 0; i < 14; i++) {
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 50);
        g.addColorStop(0, `rgba(30,28,26,${0.15 + r() * 0.25})`);
        g.addColorStop(1, 'rgba(30,28,26,0)');
        ctx.save();
        ctx.translate(r() * 512, r() * 512);
        ctx.scale(0.6 + r() * 1.4, 0.4 + r() * 0.8);
        ctx.fillStyle = g;
        ctx.fillRect(-50, -50, 100, 100);
        ctx.restore();
      }
      ctx.strokeStyle = 'rgba(40,38,36,0.55)';
      ctx.lineWidth = 2;
      for (let k = 0; k <= 4; k++) {
        ctx.beginPath();
        ctx.moveTo(k * 128, 0);
        ctx.lineTo(k * 128, 512);
        ctx.moveTo(0, k * 128);
        ctx.lineTo(512, k * 128);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(40,38,36,0.35)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 10; i++) {
        let x = r() * 512;
        let y = r() * 512;
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let k = 0; k < 5; k++) {
          x += (r() - 0.5) * 40;
          y += (r() - 0.5) * 40;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    },
    true,
  );
  // asphalt with aggregate, patches and darker racing line wear
  const asphalt = canvasTex(
    512,
    512,
    (ctx) => {
      const r = rng(99);
      ctx.fillStyle = '#35373b';
      ctx.fillRect(0, 0, 512, 512);
      for (let i = 0; i < 26000; i++) {
        const v = 40 + Math.floor(r() * 55);
        ctx.fillStyle = `rgba(${v},${v},${v + 3},${0.35 + r() * 0.5})`;
        ctx.fillRect(r() * 512, r() * 512, 1 + r() * 1.6, 1 + r() * 1.6);
      }
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = `rgba(20,21,24,${0.07 + r() * 0.08})`;
        const w = 40 + r() * 120;
        const h = 30 + r() * 90;
        ctx.fillRect(r() * 512, r() * 512, w, h);
      }
      for (let i = 0; i < 3; i++) {
        ctx.strokeStyle = 'rgba(15,15,18,0.16)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        let x = r() * 512;
        let y = r() * 512;
        ctx.moveTo(x, y);
        for (let k = 0; k < 5; k++) {
          x += (r() - 0.5) * 30;
          y += (r() - 0.5) * 30;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    },
    true,
  );
  // precast concrete barrier with panel joints
  const concrete = canvasTex(
    256,
    128,
    (ctx) => {
      const r = rng(4242);
      ctx.fillStyle = '#b3b1ab';
      ctx.fillRect(0, 0, 256, 128);
      for (let i = 0; i < 5000; i++) {
        const v = 150 + Math.floor(r() * 60);
        ctx.fillStyle = `rgba(${v},${v - 2},${v - 6},0.35)`;
        ctx.fillRect(r() * 256, r() * 128, 1 + r() * 2, 1 + r() * 2);
      }
      const g = ctx.createLinearGradient(0, 0, 0, 128);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(40,35,30,0.35)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 256, 128);
      ctx.fillStyle = 'rgba(50,48,45,0.7)';
      ctx.fillRect(0, 0, 3, 128);
      ctx.fillRect(128, 0, 3, 128);
    },
    true,
  );
  const gravel = canvasTex(
    256,
    256,
    (ctx) => {
      const r = rng(77);
      ctx.fillStyle = '#5f5d59';
      ctx.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 9000; i++) {
        const v = 60 + Math.floor(r() * 70);
        ctx.fillStyle = `rgba(${v},${v - 2},${v - 5},0.6)`;
        ctx.fillRect(r() * 256, r() * 256, 1 + r() * 2, 1 + r() * 2);
      }
    },
    true,
  );
  const facade = (seed: number, wall: string, mortar: boolean) =>
    canvasTex(
      256,
      256,
      (ctx) => {
        const r = rng(seed);
        ctx.fillStyle = wall;
        ctx.fillRect(0, 0, 256, 256);
        for (let i = 0; i < 4000; i++) {
          ctx.fillStyle = `rgba(0,0,0,${r() * 0.08})`;
          ctx.fillRect(r() * 256, r() * 256, 2, 2);
        }
        if (mortar) {
          ctx.strokeStyle = 'rgba(200,190,175,0.18)';
          ctx.lineWidth = 1;
          for (let y = 0; y < 256; y += 8) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(256, y);
            ctx.stroke();
          }
        }
        // two storeys × two windows per tile
        for (let fy = 0; fy < 2; fy++)
          for (let fx = 0; fx < 2; fx++) {
            const x = fx * 128 + 26;
            const y = fy * 128 + 30;
            ctx.fillStyle = 'rgba(40,40,40,0.8)';
            ctx.fillRect(x - 4, y - 4, 84, 64);
            const g = ctx.createLinearGradient(0, y, 0, y + 56);
            g.addColorStop(0, '#9fb3c6');
            g.addColorStop(0.5, '#4d5b69');
            g.addColorStop(1, '#2a323b');
            ctx.fillStyle = g;
            ctx.fillRect(x, y, 76, 56);
            ctx.fillStyle = 'rgba(30,30,30,0.9)';
            ctx.fillRect(x + 36, y, 4, 56);
            if (r() < 0.3) {
              ctx.fillStyle = 'rgba(255,255,255,0.15)';
              ctx.fillRect(x + 4, y + 4, 28, 48);
            }
          }
        ctx.fillStyle = 'rgba(0,0,0,0.15)';
        ctx.fillRect(0, 120, 256, 6);
        ctx.fillRect(0, 248, 256, 6);
      },
      true,
    );
  const facades = [facade(11, '#8d8a84', false), facade(12, '#7b4a3a', true), facade(13, '#b5a58c', false), facade(14, '#5e6670', false)];
  const checker = canvasTex(
    64,
    64,
    (ctx) => {
      for (let y = 0; y < 4; y++)
        for (let x = 0; x < 4; x++) {
          ctx.fillStyle = (x + y) % 2 ? '#111' : '#f2f2f2';
          ctx.fillRect(x * 16, y * 16, 16, 16);
        }
    },
    true,
  );
  // diagonal yellow/black warning stripes (ramp lips)
  const hazard = canvasTex(
    128,
    128,
    (ctx) => {
      ctx.fillStyle = '#16161a';
      ctx.fillRect(0, 0, 128, 128);
      ctx.fillStyle = '#f2b705';
      for (let k = -2; k < 4; k++) {
        ctx.beginPath();
        ctx.moveTo(k * 64, 128);
        ctx.lineTo(k * 64 + 32, 128);
        ctx.lineTo(k * 64 + 160, 0);
        ctx.lineTo(k * 64 + 128, 0);
        ctx.closePath();
        ctx.fill();
      }
    },
    true,
  );
  const chevron = canvasTex(128, 64, (ctx) => {
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, 128, 64);
    ctx.fillStyle = '#ffd23f';
    for (let i = 0; i < 3; i++) {
      const x = 10 + i * 40;
      ctx.beginPath();
      ctx.moveTo(x, 8);
      ctx.lineTo(x + 22, 32);
      ctx.lineTo(x, 56);
      ctx.lineTo(x + 12, 56);
      ctx.lineTo(x + 34, 32);
      ctx.lineTo(x + 12, 8);
      ctx.closePath();
      ctx.fill();
    }
  });
  const banner = canvasTex(1024, 128, (ctx) => {
    ctx.fillStyle = '#1c2a4a';
    ctx.fillRect(0, 0, 1024, 128);
    ctx.fillStyle = '#d6283c';
    ctx.fillRect(0, 0, 1024, 10);
    ctx.fillRect(0, 118, 1024, 10);
    ctx.font = '900 76px Orbitron, Rajdhani, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f2f2f2';
    ctx.fillText('RAGE CIRCUIT', 512, 68);
  });
  // chain-link catch fence (alpha tested)
  const fence = canvasTex(
    128,
    128,
    (ctx) => {
      ctx.clearRect(0, 0, 128, 128);
      ctx.strokeStyle = 'rgba(190,195,200,0.95)';
      ctx.lineWidth = 2;
      for (let i = -128; i < 256; i += 16) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + 128, 128);
        ctx.moveTo(i + 128, 0);
        ctx.lineTo(i, 128);
        ctx.stroke();
      }
    },
    true,
  );
  const grass = canvasTex(
    256,
    256,
    (ctx) => {
      const r = rng(555);
      ctx.fillStyle = '#4e6334';
      ctx.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 12000; i++) {
        const g = 70 + Math.floor(r() * 60);
        ctx.fillStyle = `rgba(${g - 30},${g},${g - 45},0.5)`;
        ctx.fillRect(r() * 256, r() * 256, 1, 2 + r() * 3);
      }
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = `rgba(110,95,70,${0.15 + r() * 0.2})`;
        ctx.beginPath();
        ctx.ellipse(r() * 256, r() * 256, 10 + r() * 30, 6 + r() * 20, r() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    true,
  );
  // spectators on a grandstand
  const crowd = canvasTex(
    512,
    128,
    (ctx) => {
      const r = rng(31);
      ctx.fillStyle = '#2b2d33';
      ctx.fillRect(0, 0, 512, 128);
      const shirts = ['#d6283c', '#2d5f96', '#e8e8e8', '#e0a800', '#3c7340', '#1a1a1a', '#f08030'];
      for (let row = 0; row < 8; row++) {
        for (let i = 0; i < 64; i++) {
          if (r() < 0.12) continue;
          const x = i * 8 + (row % 2) * 4 + r() * 2;
          const y = row * 16 + 4;
          ctx.fillStyle = shirts[Math.floor(r() * shirts.length)];
          ctx.fillRect(x, y + 5, 6, 8);
          ctx.fillStyle = ['#e2b58e', '#c08a64', '#8a5a3c', '#f0cfa8'][Math.floor(r() * 4)];
          ctx.fillRect(x + 1, y, 4, 5);
        }
      }
    },
    true,
  );
  const sponsor = (bg: string, fg: string, text: string, sub: string) =>
    canvasTex(512, 128, (ctx) => {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, 512, 128);
      ctx.fillStyle = fg;
      ctx.font = '900 64px Orbitron, Rajdhani, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 256, 56);
      ctx.font = '600 22px Rajdhani, sans-serif';
      ctx.fillText(sub, 256, 104);
    });
  const billboards = [
    sponsor('#d6283c', '#ffffff', 'VOLTEX', 'HIGH VOLTAGE FUEL'),
    sponsor('#101820', '#ffd23f', 'KRAKEN', 'TYRES · GRIP THAT BITES'),
    sponsor('#f2f2f2', '#1c2a4a', 'NORDHAUS', 'INDUSTRIAL STEEL'),
    sponsor('#1c6b3a', '#ffffff', 'RAPTOR', 'ENERGY DRINK'),
  ];
  return { soft, smoke, ring, ground, asphalt, concrete, gravel, facades, checker, chevron, hazard, banner, fence, grass, crowd, billboards };
}

export function textures(): ReturnType<typeof build> {
  if (!cache) cache = build();
  return cache;
}

/** Text sprite texture (car name labels). */
export function labelTexture(text: string, color: string): THREE.CanvasTexture {
  return canvasTex(256, 64, (ctx) => {
    ctx.font = '700 34px Rajdhani, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    ctx.strokeText(text, 128, 30);
    ctx.fillStyle = color;
    ctx.fillText(text, 128, 30);
  });
}

/** Racing number roundel for the car bonnet. */
export function numberTexture(n: number, color: string): THREE.CanvasTexture {
  return canvasTex(128, 128, (ctx) => {
    ctx.clearRect(0, 0, 128, 128);
    ctx.fillStyle = '#f4f4f0';
    ctx.beginPath();
    ctx.arc(64, 64, 58, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.fillStyle = '#111';
    ctx.font = '900 72px Orbitron, Rajdhani, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n), 64, 70);
  });
}
