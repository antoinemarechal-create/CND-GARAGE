
const WORKS = [
  "Entretien / vidange","Remplacement filtre à huile","Remplacement filtre à air","Remplacement filtre habitacle",
  "Remplacement filtre à carburant","Freinage avant","Freinage arrière","Pneumatiques","Éclairage / signalisation",
  "Batterie / charge","Refroidissement","Distribution","Embrayage","Transmission","Suspension","Direction",
  "Échappement","Diagnostic électronique","Géométrie","Contrôle général","Autre / précisions"
];
const FINAL_CHECKS=["Niveaux vérifiés","Absence de fuite","Éclairage / signalisation","Essai routier","Freinage","Documents de bord","Propreté du véhicule","Réinitialisation entretien"];

const DB = {
  db:null,
  open(){
    return new Promise((resolve,reject)=>{
      const r=indexedDB.open("cnd4-garage",2);
      r.onupgradeneeded=e=>{
        const db=e.target.result;
        ["clients","vehicles","interventions","staff","sync_queue","sync_meta"].forEach(s=>{
          if(!db.objectStoreNames.contains(s)) db.createObjectStore(s,{keyPath:"id"});
        });
      };
      r.onsuccess=()=>{this.db=r.result;resolve()};
      r.onerror=()=>reject(r.error);
    });
  },
  all(store){return new Promise((res,rej)=>{const r=this.db.transaction(store).objectStore(store).getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>rej(r.error)})},
  get(store,id){return new Promise((res,rej)=>{const r=this.db.transaction(store).objectStore(store).get(id);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})},
  put(store,val){return new Promise((res,rej)=>{const r=this.db.transaction(store,"readwrite").objectStore(store).put(val);r.onsuccess=()=>res(val);r.onerror=()=>rej(r.error)})},
  del(store,id){return new Promise((res,rej)=>{const r=this.db.transaction(store,"readwrite").objectStore(store).delete(id);r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})},
  clear(store){return new Promise((res,rej)=>{const r=this.db.transaction(store,"readwrite").objectStore(store).clear();r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}
};

const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const uid=()=>crypto.randomUUID ? crypto.randomUUID() : Date.now()+"-"+Math.random().toString(16).slice(2);
const nowDate=()=>new Date().toISOString().slice(0,10);
const nowTime=()=>new Date().toTimeString().slice(0,5);
function toast(msg){const t=$("#toast");t.textContent=msg;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),1800)}
function clone(id){return document.getElementById(id).content.cloneNode(true)}
function fmtDate(v){if(!v)return"—";const [y,m,d]=v.split("-");return `${d}/${m}/${y}`}
function fullClient(c){return [c?.firstName,c?.lastName].filter(Boolean).join(" ")||"Client sans nom"}
function fullVehicle(v){return [v?.make,v?.model,v?.plate&&`• ${v.plate}`].filter(Boolean).join(" ")||"Véhicule"}
function esc(s=""){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]))}


const Sync = {
  stores:["clients","vehicles","staff","interventions"],
  configured(){ return !!(localStorage.getItem("sb_url") && localStorage.getItem("sb_key")); },
  session(){ try{return JSON.parse(localStorage.getItem("sb_session")||"null")}catch{return null} },
  setStatus(kind,text){
    const b=document.getElementById("syncStatus"), t=document.getElementById("syncStatusText");
    if(!b||!t)return;
    b.classList.remove("online","offline","error","syncing");
    if(kind)b.classList.add(kind); t.textContent=text;
  },
  headers(){
    const s=this.session(), key=localStorage.getItem("sb_key")||"";
    return {"apikey":key,"Authorization":"Bearer "+(s?.access_token||""),"Content-Type":"application/json"};
  },
  async login(email,password){
    const url=(localStorage.getItem("sb_url")||"").replace(/\/$/,"");
    let r;
    try{
      r=await fetch(url+"/auth/v1/token?grant_type=password",{
        method:"POST",
        headers:{"apikey":localStorage.getItem("sb_key")||"","Content-Type":"application/json"},
        body:JSON.stringify({email,password})
      });
    }catch(e){
      throw new Error("ERREUR RÉSEAU : impossible de joindre Supabase. Vérifiez l’URL et Internet. Détail : "+e.message);
    }
    const raw=await r.text();
    let d={};
    try{d=raw?JSON.parse(raw):{}}catch{d={raw}}
    if(!r.ok){
      const detail=d.error_description||d.msg||d.message||d.error||d.code||raw||("HTTP "+r.status);
      throw new Error("SUPABASE AUTH — HTTP "+r.status+" : "+detail);
    }
    if(!d.access_token) throw new Error("SUPABASE AUTH : aucun access_token reçu.");
    localStorage.setItem("sb_session",JSON.stringify(d));
    return d;
  },
  async testPublicApi(){
    const url=(localStorage.getItem("sb_url")||"").replace(/\/$/,"");
    const key=localStorage.getItem("sb_key")||"";
    if(!/^https:\/\/.+\.supabase\.co$/i.test(url)) throw new Error("URL invalide : elle doit ressembler à https://xxxxx.supabase.co");
    if(!key) throw new Error("Clé publique absente.");
    let r;
    try{
      r=await fetch(url+"/rest/v1/clients?select=id&limit=1",{headers:{"apikey":key,"Authorization":"Bearer "+key}});
    }catch(e){
      throw new Error("ERREUR RÉSEAU : "+e.message);
    }
    const raw=await r.text();
    if(r.status===401 || r.status===403) return "URL et clé reconnues. La base demande une authentification utilisateur (normal avec les règles RLS). HTTP "+r.status+".";
    if(!r.ok) throw new Error("REST API — HTTP "+r.status+" : "+raw);
    return "URL et clé publiques valides. API Supabase joignable.";
  },
  async refreshIfNeeded(){
    const s=this.session(); if(!s?.refresh_token)return;
    if(Date.now() < ((s.expires_at||0)*1000)-60000) return;
    const url=(localStorage.getItem("sb_url")||"").replace(/\/$/,"");
    const r=await fetch(url+"/auth/v1/token?grant_type=refresh_token",{
      method:"POST",
      headers:{"apikey":localStorage.getItem("sb_key")||"","Content-Type":"application/json"},
      body:JSON.stringify({refresh_token:s.refresh_token})
    });
    const d=await r.json(); if(r.ok)localStorage.setItem("sb_session",JSON.stringify(d));
  },
  async queue(store,record,op="upsert"){
    if(!this.stores.includes(store))return;
    await DB.put("sync_queue",{id:uid(),store,record_id:record.id,op,record,createdAt:new Date().toISOString()});
    this.setStatus("offline",navigator.onLine?"À synchroniser":"Hors connexion");
    if(navigator.onLine) this.run().catch(()=>{});
  },
  async remoteUpsert(store,record){
    const url=(localStorage.getItem("sb_url")||"").replace(/\/$/,"");
    const body={id:record.id,payload:record,updated_at:record.updatedAt||new Date().toISOString()};
    const r=await fetch(`${url}/rest/v1/${store}?on_conflict=id`,{
      method:"POST",
      headers:{...this.headers(),"Prefer":"resolution=merge-duplicates,return=minimal"},
      body:JSON.stringify(body)
    });
    if(!r.ok) throw new Error(await r.text());
  },
  async remoteDelete(store,id){
    const url=(localStorage.getItem("sb_url")||"").replace(/\/$/,"");
    const r=await fetch(`${url}/rest/v1/${store}?id=eq.${encodeURIComponent(id)}`,{method:"DELETE",headers:this.headers()});
    if(!r.ok) throw new Error(await r.text());
  },
  async push(){
    const q=(await DB.all("sync_queue")).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
    for(const item of q){
      if(item.op==="delete") await this.remoteDelete(item.store,item.record_id);
      else await this.remoteUpsert(item.store,item.record);
      await DB.del("sync_queue",item.id);
    }
  },
  async pullStore(store){
    const url=(localStorage.getItem("sb_url")||"").replace(/\/$/,"");
    const meta=await DB.get("sync_meta","last_sync");
    const since=meta?.value||"1970-01-01T00:00:00.000Z";
    const r=await fetch(`${url}/rest/v1/${store}?select=id,payload,updated_at&updated_at=gt.${encodeURIComponent(since)}&order=updated_at.asc`,{headers:this.headers()});
    if(!r.ok) throw new Error(await r.text());
    const rows=await r.json();
    for(const row of rows){
      if(!row.payload)continue;
      const local=await DB.get(store,row.id);
      const remoteUpdated=row.payload.updatedAt||row.updated_at||"";
      const localUpdated=local?.updatedAt||"";
      if(!local || remoteUpdated>=localUpdated) await DB.put(store,row.payload);
    }
  },
  async run(){
    if(!this.configured()){this.setStatus("offline","Local seulement");return}
    if(!navigator.onLine){this.setStatus("offline","Hors connexion");return}
    if(!this.session()){this.setStatus("error","Connexion requise");return}
    try{
      this.setStatus("syncing","Synchronisation…");
      await this.refreshIfNeeded();
      await this.push();
      for(const s of this.stores) await this.pullStore(s);
      await DB.put("sync_meta",{id:"last_sync",value:new Date().toISOString()});
      this.setStatus("online","Synchronisé");
    }catch(e){console.error(e);this.setStatus("error","Erreur sync");}
  }
};

async function syncedPut(store,val){
  await DB.put(store,val);
  await Sync.queue(store,val,"upsert");
  return val;
}
async function syncedDel(store,id){
  const old=await DB.get(store,id);
  await DB.del(store,id);
  if(old) await Sync.queue(store,old,"delete");
}

let state={view:"dashboard",step:1,editingId:null};

function setTitle(t){$("#pageTitle").textContent=t}
function navTo(view,id=null){
  state.view=view; state.editingId=id;
  $$(".nav-btn").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  render();
}

$("#nav").addEventListener("click",e=>{
  const b=e.target.closest("[data-view]"); if(b) navTo(b.dataset.view);
});

async function render(){
  const v=$("#view"); v.innerHTML="";
  const map={dashboard:"Tableau de bord",newIntervention:"Fiche d'intervention",workshop:"Véhicules en atelier",clients:"Clients",vehicles:"Véhicules",history:"Historique",exports:"Exports PDF",staff:"Techniciens / élèves",settings:"Paramètres / sauvegarde"};
  setTitle(map[state.view]||"Garage");
  if(state.view==="dashboard") return renderDashboard();
  if(state.view==="newIntervention") return renderIntervention();
  if(state.view==="workshop") return renderInterventionList(true);
  if(state.view==="clients") return renderClients();
  if(state.view==="vehicles") return renderVehicles();
  if(state.view==="history") return renderInterventionList(false);
  if(state.view==="exports") return renderExports();
  if(state.view==="staff") return renderStaff();
  if(state.view==="settings") return renderSettings();
}

async function renderDashboard(){
  $("#view").appendChild(clone("tpl-dashboard"));
  const [clients,vehicles,interventions,staff]=await Promise.all([DB.all("clients"),DB.all("vehicles"),DB.all("interventions"),DB.all("staff")]);
  $("#metricClients").textContent=`${clients.length} client${clients.length>1?"s":""}`;
  $("#metricVehicles").textContent=`${vehicles.length} véhicule${vehicles.length>1?"s":""}`;
  $("#metricHistory").textContent=`${interventions.length} intervention${interventions.length>1?"s":""}`;
  $("#metricWorkshop").textContent=`${interventions.filter(i=>i.status!=="closed").length} véhicule${interventions.filter(i=>i.status!=="closed").length>1?"s":""}`;
  $("#metricStaff").textContent=`${staff.length} personne${staff.length>1?"s":""}`;
  const recent=interventions.sort((a,b)=>(b.updatedAt||"").localeCompare(a.updatedAt||"")).slice(0,5);
  const wrap=$("#recentInterventions");
  if(!recent.length) wrap.innerHTML='<div class="empty">Aucune intervention enregistrée.</div>';
  else for(const i of recent){
    const c=clients.find(x=>x.id===i.clientId), veh=vehicles.find(x=>x.id===i.vehicleId);
    const d=document.createElement("div"); d.className="list-item";
    d.innerHTML=`<div><strong>${esc(fullVehicle(veh))}</strong><div class="meta">${esc(fullClient(c))} • ${fmtDate(i.dateIn)}</div></div><div><span class="badge ${i.status}">${i.status==="closed"?"Clôturé":"En atelier"}</span></div>`;
    d.onclick=()=>navTo("newIntervention",i.id); wrap.appendChild(d);
  }
  $$("[data-action]").forEach(b=>b.onclick=()=>navTo(b.dataset.action));
}

function checkItems(containerId,names,prefix){
  const wrap=document.getElementById(containerId);
  names.forEach((w,idx)=>{
    const l=document.createElement("label");l.className="check-item";
    l.innerHTML=`<input type="checkbox" name="${prefix}" value="${esc(w)}"> <span>${esc(w)}</span>`;
    wrap.appendChild(l);
  });
}
function row(kind,data={}){
  const d=document.createElement("div");
  if(kind==="fluid"){d.className="row-grid";d.innerHTML=`<input data-k="name" placeholder="Produit" value="${esc(data.name||"")}"><input data-k="qty" placeholder="Quantité" value="${esc(data.qty||"")}"><input data-k="spec" placeholder="Spécification" value="${esc(data.spec||"")}"><button type="button" class="icon-btn">×</button>`}
  if(kind==="part"){d.className="row-grid parts";d.innerHTML=`<input data-k="name" placeholder="Désignation" value="${esc(data.name||"")}"><input data-k="ref" placeholder="Référence" value="${esc(data.ref||"")}"><input data-k="qty" placeholder="Qté" value="${esc(data.qty||"")}"><button type="button" class="icon-btn">×</button>`}
  if(kind==="torque"){d.className="row-grid torque";d.innerHTML=`<input data-k="part" placeholder="Organe" value="${esc(data.part||"")}"><input data-k="nm" placeholder="Nm" value="${esc(data.nm||"")}"><input data-k="note" placeholder="Observation" value="${esc(data.note||"")}"><button type="button" class="icon-btn">×</button>`}
  d.querySelector("button").onclick=()=>d.remove(); return d;
}
function dataRows(id,kind){
  return [...document.querySelectorAll(`#${id} .row-grid`)].map(r=>{
    const o={};r.querySelectorAll("[data-k]").forEach(i=>o[i.dataset.k]=i.value.trim());return o;
  }).filter(o=>Object.values(o).some(Boolean));
}


function setupSignaturePad(canvasId,hiddenInput){
  const canvas=document.getElementById(canvasId); if(!canvas)return;
  const ratio=Math.max(window.devicePixelRatio||1,1);
  const rect=canvas.getBoundingClientRect();
  canvas.width=Math.max(300,Math.floor(rect.width*ratio));
  canvas.height=Math.floor(150*ratio);
  const ctx=canvas.getContext("2d");
  ctx.scale(ratio,ratio); ctx.lineWidth=2.2; ctx.lineCap="round"; ctx.strokeStyle="#111";
  let drawing=false,last=null;
  const pos=e=>{
    const r=canvas.getBoundingClientRect(),p=e.touches?e.touches[0]:e;
    return {x:p.clientX-r.left,y:p.clientY-r.top};
  };
  const start=e=>{e.preventDefault();drawing=true;last=pos(e)};
  const move=e=>{if(!drawing)return;e.preventDefault();const p=pos(e);ctx.beginPath();ctx.moveTo(last.x,last.y);ctx.lineTo(p.x,p.y);ctx.stroke();last=p};
  const end=e=>{if(!drawing)return;drawing=false;hiddenInput.value=canvas.toDataURL("image/png")};
  canvas.addEventListener("pointerdown",start);canvas.addEventListener("pointermove",move);window.addEventListener("pointerup",end);
}
function clearSignature(canvasId,hiddenInput){
  const canvas=document.getElementById(canvasId);if(!canvas)return;
  const ctx=canvas.getContext("2d");ctx.clearRect(0,0,canvas.width,canvas.height);hiddenInput.value="";
}
function drawSavedSignature(canvasId,data){
  if(!data)return; const canvas=document.getElementById(canvasId); if(!canvas)return;
  const img=new Image();img.onload=()=>{const ctx=canvas.getContext("2d");ctx.drawImage(img,0,0,canvas.clientWidth,canvas.clientHeight)};img.src=data;
}

async function renderIntervention(){
  $("#view").appendChild(clone("tpl-new-intervention"));state.step=1;
  const form=$("#interventionForm");
  form.dateIn.value=nowDate();form.timeIn.value=nowTime();
  checkItems("requestedWorks",WORKS,"requestedWorks");
  checkItems("completedWorks",WORKS,"completedWorks");
  checkItems("finalChecks",FINAL_CHECKS,"finalChecks");

  const staff=await DB.all("staff");const sw=$("#staffChecks");
  if(!staff.length) sw.innerHTML='<div class="empty span-2">Aucun technicien/élève enregistré. Ajoutez-les dans « Techniciens / élèves ».</div>';
  else staff.forEach(s=>{const l=document.createElement("label");l.className="check-item";l.innerHTML=`<input type="checkbox" name="staffIds" value="${s.id}"><span><b>${esc(s.name)}</b><br><small>${esc(s.role||"Élève")}</small></span>`;sw.appendChild(l)});
  const professorSelect=$("#controlledBySelect");
  staff.filter(s=>/prof|enseignant|encadrant/i.test(s.role||"")).sort((a,b)=>a.name.localeCompare(b.name)).forEach(s=>{
    professorSelect.insertAdjacentHTML("beforeend",`<option value="${esc(s.name)}">${esc(s.name)}</option>`);
  });
  setupSignaturePad("teacherSignatureCanvas", form.teacherSignature);
  setupSignaturePad("customerSignatureCanvas", form.customerSignature);
  $$("[data-clear-signature]").forEach(b=>b.onclick=()=>{
    const who=b.dataset.clearSignature;
    clearSignature(who==="teacher"?"teacherSignatureCanvas":"customerSignatureCanvas", who==="teacher"?form.teacherSignature:form.customerSignature);
  });
  $("#vehicleOutCheck").onchange=e=>{
    $("#statusSelect").value=e.target.checked?"closed":"open";
    if(e.target.checked){
      if(!form.dateOut.value) form.dateOut.value=nowDate();
      if(!form.timeOut.value) form.timeOut.value=nowTime();
    }
  };
  $("#statusSelect").onchange=e=>{$("#vehicleOutCheck").checked=e.target.value==="closed";};


  const clients=await DB.all("clients");clients.sort((a,b)=>(a.lastName||"").localeCompare(b.lastName||""));
  clients.forEach(c=>$("#clientSelect").insertAdjacentHTML("beforeend",`<option value="${c.id}">${esc(fullClient(c))}</option>`));
  const vehicles=await DB.all("vehicles");vehicles.sort((a,b)=>(a.make||"").localeCompare(b.make||""));
  vehicles.forEach(v=>$("#vehicleSelect").insertAdjacentHTML("beforeend",`<option value="${v.id}">${esc(fullVehicle(v))}</option>`));

  $("#clientSelect").onchange=async e=>{
    const c=e.target.value?await DB.get("clients",e.target.value):null;if(!c)return;
    form.clientLastName.value=c.lastName||"";form.clientFirstName.value=c.firstName||"";form.clientPhone.value=c.phone||"";form.clientEmail.value=c.email||"";form.clientAddress.value=c.address||"";form.clientZip.value=c.zip||"";form.clientCity.value=c.city||"";
  };
  $("#vehicleSelect").onchange=async e=>{
    const v=e.target.value?await DB.get("vehicles",e.target.value):null;if(!v)return;
    form.vehicleMake.value=v.make||"";form.vehicleModel.value=v.model||"";form.vehicleVersion.value=v.version||"";form.vehicleFuel.value=v.fuel||"";form.vehicleYear.value=v.year||"";form.vehiclePlate.value=v.plate||"";form.vehicleVin.value=v.vin||"";form.kmIn.value=v.lastKm||form.kmIn.value;
    if(v.clientId){form.clientId.value=v.clientId;form.clientId.dispatchEvent(new Event("change"))}
  };

  $("#addFluid").onclick=()=>$("#fluidsRows").appendChild(row("fluid"));
  $("#addPart").onclick=()=>$("#partsRows").appendChild(row("part"));
  $("#addTorque").onclick=()=>$("#torquesRows").appendChild(row("torque"));
  $("#fluidsRows").appendChild(row("fluid"));
  $("#partsRows").appendChild(row("part"));
  $("#torquesRows").appendChild(row("torque"));
  buildStepper();
  $("#prevStep").onclick=()=>changeStep(-1);
  $("#nextStep").onclick=()=>changeStep(1);
  $("#saveDraft").onclick=()=>saveIntervention(false);
  form.onsubmit=async e=>{e.preventDefault();await saveIntervention(true)};
  if(state.editingId) await loadIntervention(state.editingId);
  updateStep();
}

function buildStepper(){
  const labels=["Réception","Client","Véhicule","Travaux demandés","Travaux effectués","Pièces & liquides","Couples","Techniciens / élèves","Contrôle final","Restitution"];
  const w=$("#stepper");labels.forEach((x,i)=>{const b=document.createElement("button");b.type="button";b.textContent=`${i+1}. ${x}`;b.onclick=()=>{state.step=i+1;updateStep()};w.appendChild(b)});
}
function changeStep(d){state.step=Math.max(1,Math.min(10,state.step+d));updateStep();window.scrollTo({top:0,behavior:"smooth"})}
function updateStep(){
  $$(".step").forEach(s=>s.classList.toggle("active",+s.dataset.step===state.step));
  $$("#stepper button").forEach((b,i)=>b.classList.toggle("active",i+1===state.step));
  $("#prevStep").classList.toggle("hidden",state.step===1);
  $("#nextStep").classList.toggle("hidden",state.step===10);
  $("#finishBtn").classList.toggle("hidden",state.step!==10);
}
function checked(name){return $$(`input[name="${name}"]:checked`).map(x=>x.value)}

async function saveIntervention(finish){
  const f=$("#interventionForm");
  let clientId=f.clientId.value;
  const hasClientData=[f.clientLastName.value,f.clientFirstName.value,f.clientPhone.value,f.clientEmail.value,f.clientAddress.value,f.clientZip.value,f.clientCity.value].some(v=>v.trim());
  if(!clientId && hasClientData) clientId=uid();
  if(clientId){
    const client={id:clientId,lastName:f.clientLastName.value.trim(),firstName:f.clientFirstName.value.trim(),phone:f.clientPhone.value.trim(),email:f.clientEmail.value.trim(),address:f.clientAddress.value.trim(),zip:f.clientZip.value.trim(),city:f.clientCity.value.trim(),updatedAt:new Date().toISOString()};
    await syncedPut("clients",client);
  }

  let vehicleId=f.vehicleId.value;
  const hasVehicleData=[f.vehicleMake.value,f.vehicleModel.value,f.vehicleVersion.value,f.vehicleYear.value,f.vehiclePlate.value,f.vehicleVin.value].some(v=>String(v||"").trim());
  if(!vehicleId && hasVehicleData) vehicleId=uid();
  if(vehicleId){
    const vehicle={id:vehicleId,clientId:clientId||"",make:f.vehicleMake.value.trim(),model:f.vehicleModel.value.trim(),version:f.vehicleVersion.value.trim(),fuel:f.vehicleFuel.value,year:f.vehicleYear.value,plate:f.vehiclePlate.value.trim().toUpperCase(),vin:f.vehicleVin.value.trim().toUpperCase(),lastKm:+f.kmOut.value||+f.kmIn.value||0,updatedAt:new Date().toISOString()};
    await syncedPut("vehicles",vehicle);
  }

  const id=f.id.value||uid();
  const item={id,clientId,vehicleId,dateIn:f.dateIn.value,timeIn:f.timeIn.value,kmIn:+f.kmIn.value||0,receiver:f.receiver.value.trim(),arrivalNotes:f.arrivalNotes.value.trim(),
    requestedWorks:checked("requestedWorks"),customerRequest:f.customerRequest.value.trim(),completedWorks:checked("completedWorks"),workshopNotes:f.workshopNotes.value.trim(),
    fluids:dataRows("fluidsRows","fluid"),parts:dataRows("partsRows","part"),torques:dataRows("torquesRows","torque"),staffIds:checked("staffIds"),staffNotes:f.staffNotes.value.trim(),
    finalChecks:checked("finalChecks"),kmOut:+f.kmOut.value||0,controlledBy:f.controlledBy.value.trim(),finalNotes:f.finalNotes.value.trim(),
    dateOut:f.dateOut.value,timeOut:f.timeOut.value,customerReceiver:f.customerReceiver.value.trim(),status:$("#vehicleOutCheck")?.checked ? "closed" : ($("#statusSelect")?.value||"open"),teacherSignature:f.teacherSignature.value,customerSignature:f.customerSignature.value,
    updatedAt:new Date().toISOString(),createdAt:f.dataset.createdAt||new Date().toISOString()
  };
  await syncedPut("interventions",item);state.editingId=id;f.id.value=id;toast("Intervention enregistrée.");
  if(finish){navTo(item.status==="closed"?"history":"workshop")}
}

async function loadIntervention(id){
  const i=await DB.get("interventions",id);if(!i)return;
  const f=$("#interventionForm");f.id.value=i.id;f.dataset.createdAt=i.createdAt||"";f.status.value=i.status||"open";
  const fields=["dateIn","timeIn","kmIn","receiver","arrivalNotes","customerRequest","workshopNotes","staffNotes","kmOut","controlledBy","finalNotes","dateOut","timeOut","customerReceiver"];
  fields.forEach(k=>{if(f[k])f[k].value=i[k]??""});
  if($("#statusSelect")) $("#statusSelect").value=i.status||"open";
  if($("#vehicleOutCheck")) $("#vehicleOutCheck").checked=(i.status==="closed");
  if(f.teacherSignature){f.teacherSignature.value=i.teacherSignature||"";drawSavedSignature("teacherSignatureCanvas",i.teacherSignature||"")}
  if(f.customerSignature){f.customerSignature.value=i.customerSignature||"";drawSavedSignature("customerSignatureCanvas",i.customerSignature||"")}
  f.clientId.value=i.clientId||""; if(f.clientId.value) await f.clientId.dispatchEvent(new Event("change"));
  f.vehicleId.value=i.vehicleId||""; if(f.vehicleId.value) await f.vehicleId.dispatchEvent(new Event("change"));
  ["requestedWorks","completedWorks","staffIds","finalChecks"].forEach(n=>$$(`input[name="${n}"]`).forEach(x=>x.checked=(i[n]||[]).includes(x.value)));
  $("#fluidsRows").innerHTML="";(i.fluids||[]).forEach(x=>$("#fluidsRows").appendChild(row("fluid",x)));if(!(i.fluids||[]).length)$("#fluidsRows").appendChild(row("fluid"));
  $("#partsRows").innerHTML="";(i.parts||[]).forEach(x=>$("#partsRows").appendChild(row("part",x)));if(!(i.parts||[]).length)$("#partsRows").appendChild(row("part"));
  $("#torquesRows").innerHTML="";(i.torques||[]).forEach(x=>$("#torquesRows").appendChild(row("torque",x)));if(!(i.torques||[]).length)$("#torquesRows").appendChild(row("torque"));
}

async function listData(type){
  if(type==="clients")return await DB.all("clients");
  if(type==="vehicles")return await DB.all("vehicles");
}

function closeModal(){const m=$("#crudModal");if(m)m.classList.add("hidden")}
$$("[data-close-modal]").forEach(x=>x.onclick=closeModal);

function openCrudModal(title,fields,onSave){
  $("#modalTitle").textContent=title;
  const form=$("#crudForm");form.innerHTML="";
  fields.forEach(f=>{
    const label=document.createElement("label");label.textContent=f.label;
    let input;
    if(f.type==="select"){
      input=document.createElement("select");
      (f.options||[]).forEach(o=>{const opt=document.createElement("option");opt.value=o.value;opt.textContent=o.label;input.appendChild(opt)});
    }else{
      input=document.createElement("input");input.type=f.type||"text";
    }
    input.name=f.name; input.value=f.value??""; label.appendChild(input); form.appendChild(label);
  });
  const actions=document.createElement("div");actions.className="modal-actions";
  actions.innerHTML='<button type="button" class="ghost" data-cancel>Annuler</button><button type="submit" class="primary">Enregistrer</button>';
  form.appendChild(actions);actions.querySelector("[data-cancel]").onclick=closeModal;
  form.onsubmit=async e=>{e.preventDefault();const fd=new FormData(form),obj={};for(const [k,v] of fd.entries())obj[k]=v;await onSave(obj);closeModal();};
  $("#crudModal").classList.remove("hidden");
}

async function renderClients(){
  $("#view").appendChild(clone("tpl-list-page"));
  $("#primaryAction").textContent="＋ Nouveau client";
  $("#primaryAction").onclick=()=>openClient();
  let all=await DB.all("clients"); const wrap=$("#tableWrap");

  const openClient=(c={})=>openCrudModal(c.id?"Modifier le client":"Nouveau client",[
    {name:"firstName",label:"Prénom",value:c.firstName||""},{name:"lastName",label:"Nom",value:c.lastName||""},
    {name:"phone",label:"Téléphone",value:c.phone||""},{name:"email",label:"Email",type:"email",value:c.email||""},
    {name:"address",label:"Adresse",value:c.address||""},{name:"zip",label:"Code postal",value:c.zip||""},{name:"city",label:"Ville",value:c.city||""}
  ],async d=>{await syncedPut("clients",{...c,...d,id:c.id||uid(),updatedAt:new Date().toISOString()});toast("Client enregistré.");renderClients()});

  function draw(q=""){
    const rows=all.filter(c=>JSON.stringify(c).toLowerCase().includes(q.toLowerCase()));
    wrap.innerHTML=rows.length?`<table><thead><tr><th>Client</th><th>Téléphone</th><th>Email</th><th>Ville</th><th></th></tr></thead><tbody>${rows.map(c=>`<tr><td><b>${esc(fullClient(c))}</b></td><td>${esc(c.phone||"")}</td><td>${esc(c.email||"")}</td><td>${esc(c.city||"")}</td><td><div class="action-row"><button class="ghost" data-edit="${c.id}">Modifier</button><button class="ghost danger" data-del="${c.id}">Supprimer</button></div></td></tr>`).join("")}</tbody></table>`:'<div class="empty">Aucun client.</div>';
    wrap.querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>openClient(rows.find(c=>c.id===b.dataset.edit)));
    wrap.querySelectorAll("[data-del]").forEach(b=>b.onclick=async()=>{const c=rows.find(x=>x.id===b.dataset.del);if(confirm(`Supprimer ${fullClient(c)} ?`)){await syncedDel("clients",c.id);toast("Client supprimé.");renderClients()}});
  }
  draw();$("#searchInput").oninput=e=>draw(e.target.value);
}
async function renderVehicles(){
  $("#view").appendChild(clone("tpl-list-page"));
  $("#primaryAction").textContent="＋ Nouveau véhicule";
  let [all,clients]=await Promise.all([DB.all("vehicles"),DB.all("clients")]); const wrap=$("#tableWrap");

  const openVehicle=(v={})=>openCrudModal(v.id?"Modifier le véhicule":"Nouveau véhicule",[
    {name:"make",label:"Marque",value:v.make||""},{name:"model",label:"Modèle",value:v.model||""},
    {name:"version",label:"Version",value:v.version||""},{name:"year",label:"Année",type:"number",value:v.year||""},
    {name:"plate",label:"Immatriculation",value:v.plate||""},{name:"vin",label:"N° de châssis / VIN",value:v.vin||""},
    {name:"fuel",label:"Énergie",type:"select",value:v.fuel||"",options:["","Essence","Diesel","Hybride","Électrique","GPL","Autre"].map(x=>({value:x,label:x||"—"}))},
    {name:"lastKm",label:"Kilométrage",type:"number",value:v.lastKm||""},
    {name:"clientId",label:"Propriétaire",type:"select",value:v.clientId||"",options:[{value:"",label:"— Aucun —"},...clients.map(c=>({value:c.id,label:fullClient(c)}))]}
  ],async d=>{await syncedPut("vehicles",{...v,...d,lastKm:+d.lastKm||0,plate:(d.plate||"").toUpperCase(),vin:(d.vin||"").toUpperCase(),id:v.id||uid(),updatedAt:new Date().toISOString()});toast("Véhicule enregistré.");renderVehicles()});

  $("#primaryAction").onclick=()=>openVehicle();
  function draw(q=""){
    const rows=all.filter(v=>JSON.stringify(v).toLowerCase().includes(q.toLowerCase()));
    wrap.innerHTML=rows.length?`<table><thead><tr><th>Véhicule</th><th>Immatriculation</th><th>VIN</th><th>Propriétaire</th><th>Dernier km</th><th></th></tr></thead><tbody>${rows.map(v=>`<tr><td><b>${esc([v.make,v.model,v.version].filter(Boolean).join(" ")||"Véhicule sans nom")}</b></td><td>${esc(v.plate||"")}</td><td>${esc(v.vin||"")}</td><td>${esc(fullClient(clients.find(c=>c.id===v.clientId)))}</td><td>${v.lastKm||"—"}</td><td><div class="action-row"><button class="ghost" data-edit="${v.id}">Modifier</button><button class="ghost danger" data-del="${v.id}">Supprimer</button></div></td></tr>`).join("")}</tbody></table>`:'<div class="empty">Aucun véhicule.</div>';
    wrap.querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>openVehicle(rows.find(v=>v.id===b.dataset.edit)));
    wrap.querySelectorAll("[data-del]").forEach(b=>b.onclick=async()=>{const v=rows.find(x=>x.id===b.dataset.del);if(confirm(`Supprimer ${fullVehicle(v)} ?`)){await syncedDel("vehicles",v.id);toast("Véhicule supprimé.");renderVehicles()}});
  }
  draw();$("#searchInput").oninput=e=>draw(e.target.value);
}
async function renderInterventionList(openOnly){
  $("#view").appendChild(clone("tpl-list-page"));$("#primaryAction").textContent="＋ Nouvelle réception";$("#primaryAction").onclick=()=>navTo("newIntervention");
  const [ints,clients,vehicles]=await Promise.all([DB.all("interventions"),DB.all("clients"),DB.all("vehicles")]);
  const all=ints.filter(i=>openOnly?i.status!=="closed":true).sort((a,b)=>(b.updatedAt||"").localeCompare(a.updatedAt||"")); const wrap=$("#tableWrap");
  function draw(q=""){
    const rows=all.filter(i=>{const c=clients.find(x=>x.id===i.clientId),v=vehicles.find(x=>x.id===i.vehicleId);return JSON.stringify([i,c,v]).toLowerCase().includes(q.toLowerCase())});
    wrap.innerHTML=rows.length?`<table><thead><tr><th>Date</th><th>Véhicule</th><th>Client</th><th>Techniciens / élèves</th><th>Statut</th><th></th></tr></thead><tbody>${rows.map(i=>{
      const c=clients.find(x=>x.id===i.clientId),v=vehicles.find(x=>x.id===i.vehicleId);
      return `<tr class="clickable" data-id="${i.id}"><td>${fmtDate(i.dateIn)}</td><td><b>${esc(fullVehicle(v))}</b></td><td>${esc(fullClient(c))}</td><td>${(i.staffIds||[]).length}</td><td><span class="badge ${i.status}">${i.status==="closed"?"Sorti":"En atelier"}</span></td><td><div class="action-row"><button class="ghost" data-download="${i.id}">PDF</button><button class="ghost" data-edit-int="${i.id}">Modifier</button><button class="ghost danger" data-del-int="${i.id}">Supprimer</button></div></td></tr>`}).join("")}</tbody></table>`:'<div class="empty">Aucune intervention.</div>';
    wrap.querySelectorAll("tr[data-id]").forEach(r=>r.onclick=e=>{if(e.target.closest("button"))return;navTo("newIntervention",r.dataset.id)});
    wrap.querySelectorAll("[data-edit-int]").forEach(b=>b.onclick=()=>navTo("newIntervention",b.dataset.editInt));
    wrap.querySelectorAll("[data-del-int]").forEach(b=>b.onclick=async()=>{if(confirm("Supprimer cette fiche d’intervention ?")){await syncedDel("interventions",b.dataset.delInt);toast("Fiche supprimée.");renderInterventionList(openOnly)}});
    wrap.querySelectorAll("[data-download]").forEach(b=>b.onclick=()=>downloadInterventionPdf(b.dataset.download));
  }
  draw();$("#searchInput").oninput=e=>draw(e.target.value);
}

async function renderStaff(){
  $("#view").appendChild(clone("tpl-staff"));const wrap=$("#staffList");
  async function draw(){
    const all=await DB.all("staff");wrap.innerHTML=all.length?"":'<div class="empty">Aucun technicien / élève enregistré.</div>';
    all.sort((a,b)=>a.name.localeCompare(b.name)).forEach(s=>{
      const d=document.createElement("div");d.className="staff-card";
      d.innerHTML=`<div class="who"><strong>${esc(s.name)}</strong><span>${esc(s.role||"Élève")}</span></div><div class="action-row"><button class="ghost" data-edit>Modifier</button><button class="ghost danger" data-del>Supprimer</button></div>`;
      d.querySelector("[data-edit]").onclick=()=>openStaff(s);
      d.querySelector("[data-del]").onclick=async()=>{if(confirm(`Supprimer ${s.name} ?`)){await syncedDel("staff",s.id);draw()}};
      wrap.appendChild(d)
    })
  }
  const openStaff=(s={})=>openCrudModal(s.id?"Modifier la personne":"Ajouter une personne",[
    {name:"name",label:"Nom",value:s.name||""},
    {name:"role",label:"Rôle",type:"select",value:s.role||"Élève",options:["Élève","Élève 3P","Élève 4P","Élève 5P","Professeur","Encadrant"].map(x=>({value:x,label:x}))}
  ],async d=>{await syncedPut("staff",{...s,...d,id:s.id||uid(),updatedAt:new Date().toISOString()});toast("Personne enregistrée.");draw()});
  $("#addStaffBtn").onclick=()=>openStaff();draw();
}
async function renderSettings(){
  $("#view").appendChild(clone("tpl-settings"));
  $("#supabaseUrl").value=localStorage.getItem("sb_url")||"";
  $("#supabaseAnonKey").value=localStorage.getItem("sb_key")||"";
  $("#syncEmail").value=localStorage.getItem("sb_email")||"";
  $("#syncHelp").textContent=Sync.session()?"Connecté. Synchronisation automatique active.":"Renseignez Supabase puis connectez l’atelier.";
  const diag=$("#syncDiagnostic");
  const showDiag=(ok,msg)=>{diag.classList.remove("hidden","ok","err");diag.classList.add(ok?"ok":"err");diag.textContent=msg;};

  $("#testApiBtn").onclick=async()=>{
    localStorage.setItem("sb_url",$("#supabaseUrl").value.trim().replace(/\/$/,""));
    localStorage.setItem("sb_key",$("#supabaseAnonKey").value.trim());
    try{
      showDiag(true,"Test URL + clé en cours…");
      showDiag(true,await Sync.testPublicApi());
    }catch(e){showDiag(false,"❌ "+e.message);Sync.setStatus("error","Erreur API")}
  };

  $("#connectSyncBtn").onclick=async()=>{
    try{
      const url=$("#supabaseUrl").value.trim().replace(/\/$/,"");
      const key=$("#supabaseAnonKey").value.trim();
      const email=$("#syncEmail").value.trim();
      const password=$("#syncPassword").value;
      localStorage.setItem("sb_url",url);
      localStorage.setItem("sb_key",key);
      localStorage.setItem("sb_email",email);
      if(!url) throw new Error("URL Supabase manquante.");
      if(!key) throw new Error("Clé publique manquante.");
      if(!email) throw new Error("Email atelier manquant.");
      if(!password) throw new Error("Mot de passe manquant.");
      showDiag(true,"1/3 Vérification URL + clé…");
      const api=await Sync.testPublicApi();
      showDiag(true,api+"\n\n2/3 Authentification…");
      await Sync.login(email,password);
      showDiag(true,api+"\n\nAuthentification réussie.\n\n3/3 Synchronisation…");
      $("#syncPassword").value="";
      await Sync.run();
      $("#syncHelp").textContent="Connexion réussie. Synchronisation automatique active.";
      showDiag(true,"✅ CONNEXION RÉUSSIE\n\nURL/clé : OK\nUtilisateur : OK\nSynchronisation : lancée");
      toast("Supabase connecté.");
    }catch(e){
      $("#syncHelp").textContent="Échec de connexion.";
      showDiag(false,"❌ DIAGNOSTIC\n\n"+e.message+"\n\nCopiez ce message pour me l’envoyer.");
      Sync.setStatus("error","Erreur connexion");
    }
  };
  $("#syncNowBtn").onclick=async()=>{await Sync.run();toast("Synchronisation lancée.");};
  $("#exportBtn").onclick=async()=>{
    const data={version:1,exportedAt:new Date().toISOString(),clients:await DB.all("clients"),vehicles:await DB.all("vehicles"),interventions:await DB.all("interventions"),staff:await DB.all("staff")};
    const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`cnd4-garage-sauvegarde-${nowDate()}.json`;a.click();URL.revokeObjectURL(a.href);
  };
  $("#importInput").onchange=async e=>{const file=e.target.files[0];if(!file)return;try{const d=JSON.parse(await file.text());for(const s of ["clients","vehicles","interventions","staff"]){for(const x of d[s]||[])await DB.put(s,x)}toast("Sauvegarde importée.")}catch(err){alert("Fichier invalide.")}};
  $("#resetBtn").onclick=async()=>{if(confirm("Effacer TOUTES les données locales de l'application ?")){for(const s of ["clients","vehicles","interventions","staff"])await DB.clear(s);toast("Données effacées.")}};
}

function pdfEscape(s){return String(s??"").replace(/\\/g,"\\\\").replace(/\(/g,"\\(").replace(/\)/g,"\\)").replace(/[^\x20-\x7EÀ-ÿ]/g," ")}
function wrapPdfText(text,max=92){
  const words=String(text||"").split(/\s+/),lines=[];let line="";
  for(const w of words){const test=(line+" "+w).trim();if(test.length>max){if(line)lines.push(line);line=w}else line=test}
  if(line)lines.push(line);return lines.length?lines:[""];
}
function createSimplePdf(pages){
  const objects=[null];
  const add=o=>{objects.push(o);return objects.length-1};
  const fontId=add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const boldId=add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  const pageIds=[], contentIds=[];
  for(const lines of pages){
    let y=805, stream="BT\n";
    for(const line of lines){
      const bold=line.bold?"/F2":"/F1",size=line.size||9;
      stream+=`${bold} ${size} Tf\n1 0 0 1 ${line.x||35} ${y} Tm\n(${pdfEscape(line.text)}) Tj\n`;
      y-=line.gap||12;
    }
    stream+="ET";
    const cid=add(`<< /Length ${new Blob([stream]).size} >>\nstream\n${stream}\nendstream`);
    contentIds.push(cid);
    pageIds.push(add(""));
  }
  const pagesId=add("");
  const catalogId=add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  pageIds.forEach((pid,idx)=>{
    objects[pid]=`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R /F2 ${boldId} 0 R >> >> /Contents ${contentIds[idx]} 0 R >>`;
  });
  objects[pagesId]=`<< /Type /Pages /Kids [${pageIds.map(id=>id+" 0 R").join(" ")}] /Count ${pageIds.length} >>`;
  let pdf="%PDF-1.4\n",offsets=[0];
  for(let i=1;i<objects.length;i++){offsets[i]=pdf.length;pdf+=`${i} 0 obj\n${objects[i]}\nendobj\n`}
  const xref=pdf.length;pdf+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for(let i=1;i<objects.length;i++)pdf+=String(offsets[i]).padStart(10,"0")+" 00000 n \n";
  pdf+=`trailer\n<< /Size ${objects.length} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([pdf],{type:"application/pdf"});
}
async function interventionPdfLines(i){
  const [c,v,staff]=await Promise.all([DB.get("clients",i.clientId),DB.get("vehicles",i.vehicleId),DB.all("staff")]);
  const team=(i.staffIds||[]).map(id=>staff.find(s=>s.id===id)?.name).filter(Boolean).join(", ");
  const lines=[
    {text:"C.N.D. 4 DINANT GARAGE",bold:true,size:16,gap:18},
    {text:"FICHE D'INTERVENTION - ATELIER SCOLAIRE",bold:true,size:10,gap:18},
    {text:`Date : ${fmtDate(i.dateIn)}   Statut : ${i.status==="closed"?"SORTI / CLOTURE":"EN ATELIER"}`,bold:true,gap:16},
    {text:`Client : ${fullClient(c)}`},{text:`Telephone : ${c?.phone||""}   Email : ${c?.email||""}`},
    {text:`Vehicule : ${fullVehicle(v)}`},{text:`Version : ${v?.version||""}   VIN : ${v?.vin||""}`},
    {text:`Kilometrage entree : ${i.kmIn||""} km   sortie : ${i.kmOut||""} km`,gap:16},
    {text:"TECHNICIENS / ELEVES",bold:true,gap:14},{text:team||"—",gap:16},
    {text:"TRAVAUX DEMANDES",bold:true,gap:14}
  ];
  (i.requestedWorks||[]).forEach(x=>wrapPdfText("• "+x).forEach(t=>lines.push({text:t})));
  if(i.customerRequest)wrapPdfText(i.customerRequest).forEach(t=>lines.push({text:t}));
  lines.push({text:"TRAVAUX EFFECTUES",bold:true,gap:14});
  (i.completedWorks||[]).forEach(x=>wrapPdfText("• "+x).forEach(t=>lines.push({text:t})));
  if(i.workshopNotes)wrapPdfText(i.workshopNotes).forEach(t=>lines.push({text:t}));
  lines.push({text:"PIECES",bold:true,gap:14});
  (i.parts||[]).forEach(x=>wrapPdfText(`• ${x.name||""} ${x.ref?`(${x.ref})`:""} - Qte ${x.qty||""}`).forEach(t=>lines.push({text:t})));
  lines.push({text:"LIQUIDES",bold:true,gap:14});
  (i.fluids||[]).forEach(x=>wrapPdfText(`• ${x.name||""} - ${x.qty||""} ${x.spec||""}`).forEach(t=>lines.push({text:t})));
  lines.push({text:"COUPLES DE SERRAGE",bold:true,gap:14});
  (i.torques||[]).forEach(x=>wrapPdfText(`• ${x.part||""} - ${x.nm||""} Nm ${x.note||""}`).forEach(t=>lines.push({text:t})));
  lines.push({text:"CONTROLE FINAL",bold:true,gap:14});
  (i.finalChecks||[]).forEach(x=>wrapPdfText("• "+x).forEach(t=>lines.push({text:t})));
  if(i.controlledBy)lines.push({text:`Controle par : ${i.controlledBy}`});
  if(i.finalNotes)wrapPdfText(i.finalNotes).forEach(t=>lines.push({text:t}));
  lines.push({text:`Restitution : ${fmtDate(i.dateOut)} ${i.timeOut||""}`,gap:14});
  lines.push({text:"Signatures tactiles enregistrees dans l'application.",size:8});
  return lines.slice(0,62);
}
function saveBlob(blob,filename){const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
async function downloadInterventionPdf(id){
  const i=await DB.get("interventions",id);if(!i)return;
  const blob=createSimplePdf([await interventionPdfLines(i)]);
  saveBlob(blob,`fiche-intervention-${i.dateIn||"sans-date"}-${id.slice(0,8)}.pdf`);
}
async function renderExports(){
  $("#view").appendChild(clone("tpl-exports"));
  const ints=(await DB.all("interventions")).sort((a,b)=>(b.dateIn||"").localeCompare(a.dateIn||""));
  const clients=await DB.all("clients"),vehicles=await DB.all("vehicles");
  const sel=$("#singlePdfSelect");
  sel.innerHTML=ints.length?ints.map(i=>{
    const c=clients.find(x=>x.id===i.clientId),v=vehicles.find(x=>x.id===i.vehicleId);
    return `<option value="${i.id}">${fmtDate(i.dateIn)} — ${esc(fullVehicle(v))} — ${esc(fullClient(c))}</option>`
  }).join(""):'<option value="">Aucune intervention</option>';
  $("#monthPdfInput").value=new Date().toISOString().slice(0,7);
  $("#downloadSinglePdf").onclick=()=>{if(sel.value)downloadInterventionPdf(sel.value)};
  $("#downloadMonthPdf").onclick=async()=>{
    const month=$("#monthPdfInput").value;if(!month)return toast("Choisissez un mois.");
    const chosen=ints.filter(i=>(i.dateIn||"").startsWith(month));
    if(!chosen.length)return toast("Aucune fiche pour ce mois.");
    const pages=[];for(const i of chosen)pages.push(await interventionPdfLines(i));
    saveBlob(createSimplePdf(pages),`CND4-fiches-${month}.pdf`);
    toast(`${chosen.length} fiche(s) téléchargée(s).`);
  };
}

async function printIntervention(id){
  const [i,staff]=await Promise.all([DB.get("interventions",id),DB.all("staff")]);if(!i)return;
  const c=await DB.get("clients",i.clientId),v=await DB.get("vehicles",i.vehicleId);
  const team=(i.staffIds||[]).map(id=>staff.find(s=>s.id===id)?.name).filter(Boolean);
  const list=a=>(a&&a.length)?`<ul class="print-list">${a.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`:"—";
  $("#printArea").innerHTML=`<div class="print-sheet">
    <div class="print-head"><div><h1>C.N.D. 4 DINANT GARAGE</h1><p>FICHE D'INTERVENTION — ATELIER SCOLAIRE</p></div><img src="logo-cnd4-garage.png"></div>
    <div class="print-grid">
      <div class="print-box"><h3>Client</h3><p><b>${esc(fullClient(c))}</b></p><p>${esc(c?.address||"")} ${esc(c?.zip||"")} ${esc(c?.city||"")}</p><p>${esc(c?.phone||"")} • ${esc(c?.email||"")}</p></div>
      <div class="print-box"><h3>Véhicule</h3><p><b>${esc(fullVehicle(v))}</b></p><p>Version : ${esc(v?.version||"—")} • Énergie : ${esc(v?.fuel||"—")}</p><p>VIN : ${esc(v?.vin||"—")} • Année : ${esc(v?.year||"—")}</p></div>
      <div class="print-box"><h3>Intervention</h3><p>Entrée : ${fmtDate(i.dateIn)} ${esc(i.timeIn||"")} • ${i.kmIn||"—"} km</p><p>Sortie : ${fmtDate(i.dateOut)} ${esc(i.timeOut||"")} • ${i.kmOut||"—"} km</p><p>Réceptionnaire : ${esc(i.receiver||"—")} • Contrôle : ${esc(i.controlledBy||"—")}</p></div>
      <div class="print-box"><h3>Techniciens / élèves</h3><p>${team.length?esc(team.join(", ")):"—"}</p><p>${esc(i.staffNotes||"")}</p></div>
      <div class="print-box"><h3>Travaux demandés</h3>${list(i.requestedWorks)}<p>${esc(i.customerRequest||"")}</p></div>
      <div class="print-box"><h3>Travaux effectués</h3>${list(i.completedWorks)}<p>${esc(i.workshopNotes||"")}</p></div>
      <div class="print-box"><h3>Liquides ajoutés</h3>${list((i.fluids||[]).map(x=>`${x.name} — ${x.qty||""} ${x.spec?`— ${x.spec}`:""}`))}</div>
      <div class="print-box"><h3>Pièces placées / remplacées</h3>${list((i.parts||[]).map(x=>`${x.name} ${x.ref?`(${x.ref})`:""} — Qté ${x.qty||"—"}`))}</div>
      <div class="print-box"><h3>Couples de serrage</h3>${list((i.torques||[]).map(x=>`${x.part} — ${x.nm||"—"} Nm ${x.note?`— ${x.note}`:""}`))}</div>
      <div class="print-box"><h3>Contrôle final</h3>${list(i.finalChecks)}<p>${esc(i.finalNotes||"")}</p></div>
    </div>
    <div class="print-sign" style="margin-top:6px"><div><b>Validation professeur / encadrant</b>${i.teacherSignature?.startsWith("data:image")?`<img src="${i.teacherSignature}" style="max-width:180px;max-height:45px">`:`<p>${esc(i.teacherSignature||"")}</p>`}</div><div><b>Réception par le client</b>${i.customerSignature?.startsWith("data:image")?`<img src="${i.customerSignature}" style="max-width:180px;max-height:45px">`:`<p>${esc(i.customerSignature||i.customerReceiver||"")}</p>`}</div></div>
  </div>`;
  setTimeout(()=>window.print(),120);
}

(async()=>{
  await DB.open();
  if("serviceWorker" in navigator){
    navigator.serviceWorker.register("sw.js",{updateViaCache:"none"}).then(reg=>reg.update()).catch(()=>{});
  }
  window.addEventListener("online",()=>Sync.run());
  window.addEventListener("offline",()=>Sync.setStatus("offline","Hors connexion"));
  const sb=document.getElementById("syncStatus"); if(sb) sb.addEventListener("click",()=>navTo("settings"));
  await render();
  Sync.run().catch(()=>{});
  setInterval(()=>Sync.run().catch(()=>{}),60000);
})();
