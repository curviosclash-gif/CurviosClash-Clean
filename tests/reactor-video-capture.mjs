import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

// Opt-in review media. Uses the actual game renderer and a fixed map clock/camera,
// with all frames streamed to ffmpeg instead of leaving thousands of PNGs behind.
export async function captureReactorVideo(page, variant, directory) {
    await mkdir(directory, { recursive: true });
    const filename = path.join(directory, `variant-${variant + 1}.mp4`);
    const fps = 24, frames = 384;
    const encoder = spawn('ffmpeg', ['-y','-loglevel','error','-f','image2pipe','-framerate',String(fps),
        '-i','pipe:0','-an','-c:v','libx264','-preset','fast','-crf','19','-pix_fmt','yuv420p','-movflags','+faststart',filename],
    { windowsHide: true, stdio: ['pipe','ignore','pipe'] });
    let errorText = '';
    encoder.stderr.on('data',(chunk)=>{ errorText += chunk.toString(); });
    const finished = once(encoder,'close');
    await page.evaluate(() => {
        const g=window.GAME_INSTANCE;
        g.renderer.qualityController?.setQualityLock?.(true,'reactor-video');
        g.entityManager.particles?.clear?.();
    });
    try {
        for (let frame=0;frame<frames;frame++) {
            const png = await page.evaluate(({time}) => {
                const g=window.GAME_INSTANCE, arena=g.arena;
                arena.setGlbAnimationElapsedSeconds(time);arena._glbAnimation.advance(0);
                const r=g.renderer.renderer,camera=g.renderer.cameras[0];
                const oldPosition=camera.position.clone(),oldRotation=camera.quaternion.clone(),oldFar=camera.far;
                const oldFov=camera.fov, oldAspect=camera.aspect;
                camera.position.set(1050,520,1150);camera.lookAt(0,490,0);camera.far=5000;
                camera.fov=50;camera.aspect=16/9;
                camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
                r.setRenderTarget(null);r.render(g.renderer.scene,camera);
                const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;
                canvas.getContext('2d').drawImage(r.domElement,0,0,960,540);
                const result=canvas.toDataURL('image/png');
                camera.position.copy(oldPosition);camera.quaternion.copy(oldRotation);camera.far=oldFar;
                camera.fov=oldFov;camera.aspect=oldAspect;
                camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
                return result;
            },{time:49*frame/(frames-1)});
            if (!encoder.stdin.write(Buffer.from(png.split(',')[1],'base64'))) await once(encoder.stdin,'drain');
        }
        encoder.stdin.end();
        const [code]=await finished;
        if(code!==0) throw new Error(`ffmpeg ${code}: ${errorText}`);
    } finally {
        if(encoder.exitCode===null) encoder.kill();
        await page.evaluate(()=>window.GAME_INSTANCE.renderer.qualityController?.setQualityLock?.(false,'reactor-video'));
    }
}
