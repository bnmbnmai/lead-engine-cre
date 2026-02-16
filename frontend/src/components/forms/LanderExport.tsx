import { useState } from 'react';
import { Download, Copy, CheckCircle2, Monitor, Smartphone, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { VERTICAL_EMOJI } from './StepProgress';

// ============================================
// Types
// ============================================

interface FormField {
    id: string;
    key: string;
    label: string;
    type: string;
    required: boolean;
    placeholder?: string;
    options?: string[];
}

interface FormStep {
    id: string;
    label: string;
    fieldIds: string[];
}

interface LanderExportProps {
    vertical: string;
    sellerId?: string;
    fields: FormField[];
    steps: FormStep[];
    gamification: {
        showProgress: boolean;
        showNudges: boolean;
        confetti: boolean;
    };
    apiEndpoint?: string;
}

// ============================================
// HTML Generator
// ============================================

function generateLanderHTML(
    config: LanderExportProps,
    theme: 'light' | 'dark'
): string {
    const { vertical, sellerId, fields, steps, gamification, apiEndpoint } = config;
    const emoji = VERTICAL_EMOJI[vertical] || '📋';
    const verticalLabel = vertical.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const isDark = theme === 'dark';
    const bg = isDark ? '#0a0a0b' : '#ffffff';
    const fg = isDark ? '#fafafa' : '#09090b';
    const muted = isDark ? '#a1a1aa' : '#71717a';
    const accent = '#6366f1';
    const cardBg = isDark ? '#18181b' : '#f4f4f5';
    const border = isDark ? '#27272a' : '#e4e4e7';

    const fieldsByStep = steps.map((step) => ({
        ...step,
        fields: step.fieldIds.map((fid) => fields.find((f) => f.id === fid)).filter(Boolean) as FormField[],
    }));

    const renderFieldHTML = (f: FormField) => {
        const req = f.required ? ' required' : '';
        const ph = f.placeholder ? ` placeholder="${f.placeholder}"` : '';

        if (f.type === 'select' && f.options?.length) {
            return `<select name="${f.key}"${req} class="lf-input"><option value="">Select ${f.label}</option>${f.options.map((o) => `<option value="${o}">${o}</option>`).join('')}</select>`;
        }
        if (f.type === 'boolean') {
            return `<label class="lf-toggle"><input type="checkbox" name="${f.key}"><span>${f.label}</span></label>`;
        }
        if (f.type === 'textarea') {
            return `<textarea name="${f.key}"${req}${ph} rows="3" class="lf-input"></textarea>`;
        }
        const inputType = f.type === 'phone' ? 'tel' : f.type === 'number' ? 'number' : f.type === 'email' ? 'email' : 'text';
        return `<input type="${inputType}" name="${f.key}"${req}${ph} class="lf-input">`;
    };

    const stepsJSON = JSON.stringify(fieldsByStep.map((s, i) => ({ label: s.label, idx: i })));

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Get Your Free ${verticalLabel} Quote ${emoji}</title>
<meta name="description" content="Get a free ${verticalLabel.toLowerCase()} quote from top-rated providers in your area.">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:${bg};color:${fg};min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px}
.lf-container{width:100%;max-width:480px}
.lf-card{background:${cardBg};border:1px solid ${border};border-radius:16px;padding:32px;box-shadow:0 4px 24px rgba(0,0,0,${isDark ? '0.4' : '0.08'})}
.lf-header{text-align:center;margin-bottom:24px}
.lf-header h1{font-size:24px;font-weight:700;margin-bottom:4px}
.lf-header p{font-size:14px;color:${muted}}
.lf-progress{margin-bottom:24px}
.lf-progress-bar{height:6px;background:${border};border-radius:99px;overflow:hidden;margin-bottom:8px}
.lf-progress-fill{height:100%;background:linear-gradient(90deg,${accent},#818cf8);border-radius:99px;transition:width 0.5s ease}
.lf-nudge{font-size:13px;color:${accent};font-weight:600;text-align:center;min-height:20px;transition:opacity 0.3s}
.lf-step{display:none;animation:fadeIn 0.3s ease}
.lf-step.active{display:block}
.lf-label{display:block;font-size:14px;font-weight:500;margin-bottom:6px}
.lf-label .req{color:#ef4444;margin-left:2px}
.lf-field{margin-bottom:16px}
.lf-input{width:100%;height:44px;border:1px solid ${border};border-radius:10px;padding:0 14px;font-size:14px;background:${bg};color:${fg};outline:none;transition:border-color 0.2s}
.lf-input:focus{border-color:${accent};box-shadow:0 0 0 3px ${accent}22}
textarea.lf-input{height:auto;padding:10px 14px}
select.lf-input{appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='${encodeURIComponent(muted)}' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10z'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center}
.lf-toggle{display:flex;align-items:center;gap:8px;font-size:14px;cursor:pointer}
.lf-toggle input{width:18px;height:18px;accent-color:${accent}}
.lf-tcpa{font-size:11px;color:${muted};line-height:1.4;padding:12px;border:1px solid ${border};border-radius:10px;margin-bottom:16px;display:flex;gap:8px;align-items:flex-start}
.lf-tcpa input{margin-top:2px;flex-shrink:0;width:16px;height:16px}
.lf-btn{width:100%;height:48px;border:none;border-radius:10px;background:${accent};color:#fff;font-size:15px;font-weight:600;cursor:pointer;transition:opacity 0.2s,transform 0.1s}
.lf-btn:hover{opacity:0.9}
.lf-btn:active{transform:scale(0.98)}
.lf-btn:disabled{opacity:0.5;cursor:not-allowed}
.lf-nav{display:flex;gap:8px;margin-top:16px}
.lf-nav button{flex:1;height:40px;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;transition:opacity 0.2s}
.lf-back{background:transparent;border:1px solid ${border};color:${fg}}
.lf-next{background:${accent};border:none;color:#fff}
.lf-steps-indicator{display:flex;justify-content:center;gap:6px;margin-top:12px}
.lf-dot{width:8px;height:8px;border-radius:50%;background:${border};transition:all 0.3s}
.lf-dot.done{background:${accent}}
.lf-dot.current{background:${accent};transform:scale(1.3)}
.lf-success{text-align:center;padding:40px 0;animation:fadeIn 0.5s ease}
.lf-success h2{font-size:28px;margin-bottom:8px}
.lf-success p{color:${muted};font-size:14px}
@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
@media(max-width:480px){.lf-card{padding:20px;border-radius:12px}.lf-header h1{font-size:20px}}
</style>
</head>
<body>
<div class="lf-container">
<div class="lf-card">
<div class="lf-header">
<h1>${emoji} Free ${verticalLabel} Quote</h1>
<p>Fill out the form below and we'll connect you with top providers in your area.</p>
</div>
${gamification.showProgress ? `<div class="lf-progress"><div class="lf-progress-bar"><div class="lf-progress-fill" id="pbar" style="width:0%"></div></div>${gamification.showNudges ? '<div class="lf-nudge" id="nudge"></div>' : ''}</div>` : ''}
<form id="leadForm" novalidate>
${fieldsByStep.map((step, si) => `<div class="lf-step${si === 0 ? ' active' : ''}" data-step="${si}">
<h3 style="font-size:15px;font-weight:600;margin-bottom:16px">${step.label}</h3>
${step.fields.map((f) => `<div class="lf-field"><label class="lf-label">${f.label}${f.required ? '<span class="req">*</span>' : ''}</label>${renderFieldHTML(f)}</div>`).join('\n')}
</div>`).join('\n')}
<div class="lf-step" data-step="${fieldsByStep.length}">
<div class="lf-tcpa"><input type="checkbox" id="tcpa" required><span>By submitting, I consent to being contacted by phone, text, or email. I understand I may receive automated communications. Consent is not a condition of purchase.</span></div>
<button type="submit" class="lf-btn" id="submitBtn" disabled>Get My Free Quote</button>
</div>
<div class="lf-nav" id="navBtns">
<button type="button" class="lf-back" id="backBtn" style="display:none" onclick="go(-1)">Back</button>
<button type="button" class="lf-next" id="nextBtn" onclick="go(1)">Next →</button>
</div>
<div class="lf-steps-indicator" id="dots"></div>
</form>
<div class="lf-success" id="success" style="display:none">
<h2>🎉 Thank You!</h2>
<p>We've received your information. A top-rated ${verticalLabel.toLowerCase()} provider will contact you shortly.</p>
</div>
</div>
</div>
<script>
(function(){
var steps=${stepsJSON};
var total=steps.length+1;
var cur=0;
var dots=document.getElementById('dots');
for(var i=0;i<total;i++){var d=document.createElement('span');d.className='lf-dot'+(i===0?' current':'');dots.appendChild(d)}
var allDots=dots.children;
var pbar=document.getElementById('pbar');
var nudge=document.getElementById('nudge');
var backBtn=document.getElementById('backBtn');
var nextBtn=document.getElementById('nextBtn');
var navBtns=document.getElementById('navBtns');
var tcpa=document.getElementById('tcpa');
var submitBtn=document.getElementById('submitBtn');
if(tcpa)tcpa.addEventListener('change',function(){submitBtn.disabled=!tcpa.checked});
function render(){
var ss=document.querySelectorAll('.lf-step');
ss.forEach(function(s,i){s.classList.toggle('active',i===cur)});
for(var i=0;i<allDots.length;i++){allDots[i].className='lf-dot'+(i<cur?' done':'')+(i===cur?' current':'')}
if(pbar)pbar.style.width=Math.round((cur/(total-1))*100)+'%';
if(nudge){
var p=Math.round((cur/total)*100);
var msgs=['Let\\'s get started — just '+total+' quick steps!',''+p+'% Complete — great start!',''+p+'% Complete — almost there!','Last step — let\\'s go! 🎉'];
nudge.textContent=msgs[Math.min(cur,msgs.length-1)]
}
backBtn.style.display=cur===0?'none':'';
if(cur===total-1){nextBtn.style.display='none';navBtns.style.display=tcpa?'flex':'none'}else{nextBtn.style.display='';navBtns.style.display='flex'}
}
window.go=function(dir){
var next=cur+dir;
if(next<0||next>=total)return;
if(dir===1){
var active=document.querySelector('.lf-step.active');
var inputs=active.querySelectorAll('[required]');
for(var i=0;i<inputs.length;i++){if(!inputs[i].value&&inputs[i].type!=='checkbox'){inputs[i].style.borderColor='#ef4444';inputs[i].focus();return}inputs[i].style.borderColor=''}
}
cur=next;render()
};
document.getElementById('leadForm').addEventListener('submit',function(e){
e.preventDefault();
var fd=new FormData(e.target);
var data={};fd.forEach(function(v,k){data[k]=v});
data.vertical='${vertical}';
${sellerId ? `data.sellerId='${sellerId}';` : `// TODO: set data.sellerId to the seller's user ID before deploying`}
data.tcpaConsentAt=new Date().toISOString();
${apiEndpoint ? `fetch('${apiEndpoint}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(function(){})['catch'](function(){});` : '// Configure apiEndpoint to enable submission'}
document.getElementById('leadForm').style.display='none';
document.getElementById('navBtns').style.display='none';
document.getElementById('dots').style.display='none';
var pg=document.querySelector('.lf-progress');if(pg)pg.style.display='none';
document.getElementById('success').style.display='block';
});
render()
})();
</script>
</body>
</html>`;
}

// ============================================
// Component
// ============================================

export function LanderExport(props: LanderExportProps) {
    const [theme, setTheme] = useState<'light' | 'dark'>('dark');
    const [preview, setPreview] = useState<'desktop' | 'mobile'>('desktop');
    const [copied, setCopied] = useState(false);

    const html = generateLanderHTML(props, theme);

    const download = () => {
        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${props.vertical}-lead-form.html`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const copyEmbed = () => {
        const snippet = `<div id="leadengine-form"></div>\n<script src="${props.apiEndpoint || '/api'}/embed/${props.vertical}.js"></script>`;
        navigator.clipboard.writeText(snippet);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="space-y-4">
            {/* Controls */}
            <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex gap-1 p-1 rounded-lg bg-muted/50">
                    <button
                        onClick={() => setTheme('light')}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition ${theme === 'light' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                            }`}
                    >
                        <Sun className="h-3.5 w-3.5" />
                        Light
                    </button>
                    <button
                        onClick={() => setTheme('dark')}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition ${theme === 'dark' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                            }`}
                    >
                        <Moon className="h-3.5 w-3.5" />
                        Dark
                    </button>
                </div>

                <div className="flex gap-1 p-1 rounded-lg bg-muted/50">
                    <button
                        onClick={() => setPreview('desktop')}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition ${preview === 'desktop' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                            }`}
                    >
                        <Monitor className="h-3.5 w-3.5" />
                        Desktop
                    </button>
                    <button
                        onClick={() => setPreview('mobile')}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition ${preview === 'mobile' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                            }`}
                    >
                        <Smartphone className="h-3.5 w-3.5" />
                        Mobile
                    </button>
                </div>
            </div>

            {/* Preview iframe */}
            <Card>
                <CardContent className="p-0">
                    <div
                        className={`mx-auto transition-all duration-300 ${preview === 'mobile' ? 'max-w-[375px]' : 'max-w-full'
                            }`}
                    >
                        <iframe
                            srcDoc={html}
                            className="w-full border-0 rounded-xl"
                            style={{ height: '600px' }}
                            title="Lander Preview"
                            sandbox="allow-scripts"
                        />
                    </div>
                </CardContent>
            </Card>

            {/* Actions */}
            <div className="flex gap-3">
                <Button onClick={download} className="flex-1">
                    <Download className="h-4 w-4 mr-2" />
                    Download HTML
                </Button>
                <Button variant="outline" onClick={copyEmbed} className="flex-1">
                    {copied ? (
                        <>
                            <CheckCircle2 className="h-4 w-4 mr-2 text-green-500" />
                            Copied!
                        </>
                    ) : (
                        <>
                            <Copy className="h-4 w-4 mr-2" />
                            Copy Embed Code
                        </>
                    )}
                </Button>
            </div>
        </div>
    );
}

export { generateLanderHTML };
export default LanderExport;
