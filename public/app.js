const categories=["Tout","Terrains","Maisons","Téléphones","Motos","Maison & Déco","Mode","Services","Emploi","Autres"];
const communes=["Banikoara","Gogounou","Kandi","Karimama","Malanville","Ségbana","Boukoumbé","Cobly","Kérou","Kouandé","Matéri","Natitingou","Péhunco","Tanguiéta","Toucountouna","Abomey-Calavi","Allada","Kpomassè","Ouidah","Sô-Ava","Toffo","Tori-Bossito","Zè","Bembèrèkè","Kalalé","N'Dali","Nikki","Parakou","Pèrèrè","Sinendé","Tchaourou","Bantè","Dassa-Zoumè","Glazoué","Ouèssè","Savalou","Savè","Aplahoué","Djakotomey","Dogbo","Klouékanmè","Lalo","Toviklin","Bassila","Copargo","Djougou","Ouaké","Cotonou","Athiémé","Bopa","Comè","Grand-Popo","Houéyogbé","Lokossa","Adjarra","Adjohoun","Aguégués","Akpro-Missérété","Avrankou","Bonou","Dangbo","Porto-Novo","Sèmè-Kpodji","Adja-Ouèrè","Ifangni","Kétou","Pobè","Sakété","Abomey","Agbangnizoun","Bohicon","Covè","Djidja","Ouinhi","Za-Kpota","Zangnanado","Zogbodomey"];
let activeCategory="";

function money(n){return n?new Intl.NumberFormat("fr-FR").format(n)+" F CFA":"Sur devis";}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}

function renderCategories(){
  document.getElementById("categories").innerHTML=categories.map(c=>{
    const v=c==="Tout"?"":c;
    return `<button class="${activeCategory===v?"active":""}" onclick="setCategory('${v}')">${c}</button>`;
  }).join("");
}

function setCategory(c){activeCategory=c;renderCategories();loadListings();}

function renderZones(){
  const sel=document.getElementById("zone");
  sel.innerHTML='<option value="">Toute zone</option>'+communes.map(c=>`<option>${c}</option>`).join("");
}

async function loadListings(){
  const p=new URLSearchParams();
  const q=document.getElementById("search").value;
  const z=document.getElementById("zone").value;
  if(q)p.set("search",q);
  if(z)p.set("zone",z);
  if(activeCategory)p.set("category",activeCategory);

  const r=await fetch("/api/listings?"+p.toString());
  const a=await r.json();
  document.getElementById("listings").innerHTML=a.length?a.map(card).join(""):"<div class='notice'>Aucune annonce trouvée.</div>";
}

function card(x){
  const img=x.images&&x.images.length?`<img src="${x.images[0]}" alt="">`:"📦";
  const boosted=x.boost_until&&new Date(x.boost_until)>new Date();
  const waText=encodeURIComponent(`${x.title} — ${money(x.price)} — ${x.zone}\nVoir sur BON PLAN 229 : ${window.location.origin}`);
  const isRealEstate=x.category==="Terrains"||x.category==="Maisons";
  const buyButton=x.price>0&&!isRealEstate?`<button class="safe" onclick="protectedPurchase(${x.id},${x.price})">🛡️ Acheter</button>`:"";
  const realEstateNotice=isRealEstate?`<p class="notice small">⚠️ Vérifiez les documents fonciers avant tout paiement. L'achat en ligne n'est pas disponible pour l'immobilier.</p>`:"";
  return `<article class="card${boosted?" boosted":""}">
    <div class="image">${img}${boosted?'<span class="badge">⭐ En avant</span>':""}</div>
    <div class="body">
      <small>${esc(x.category)}</small>
      <h3>${esc(x.title)}</h3>
      <div class="price">${money(x.price)}</div>
      <div class="meta">📍 ${esc(x.zone)}</div>
      <p>${esc(x.description)}</p>
      ${realEstateNotice}
      <div class="actions">
        <button onclick="contact('${encodeURIComponent(x.phone)}')">Contacter</button>
        ${buyButton}
      </div>
      <a class="whatsapp" href="https://wa.me/?text=${waText}" target="_blank" rel="noopener">📲 Partager sur WhatsApp</a>
    </div>
  </article>`;
}

// ---------- Publication : pack (1er gratuit, puis 100F / 5 annonces / 48h) ----------

function openPublish(){
  openModal(`<h2>Publier des annonces</h2>
  <p class="notice">Votre 1ère publication est <strong>gratuite</strong> (5 annonces, 48h). Ensuite : 100 F CFA pour 5 nouvelles annonces.</p>
  <form class="form" id="packForm">
    <input class="field" name="phone" required placeholder="Votre téléphone" value="${localStorage.getItem("bp229_phone")||""}">
    <button class="safe">Continuer</button>
  </form>`);
  document.getElementById("packForm").addEventListener("submit",buyPack);
}

async function buyPack(e){
  e.preventDefault();
  const phone=new FormData(e.target).get("phone");
  localStorage.setItem("bp229_phone",phone);
  const r=await fetch("/api/packs",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phone})});
  const result=await r.json();
  if(!r.ok)return alert(result.error);
  if(result.free){
    openModal(`<h2>✅ C'est gratuit pour vous !</h2><p class="notice">Vous pouvez publier 5 annonces, valables 48h.</p><button class="safe" onclick="closeModal();openPublishForm(${result.packId})">Publier ma première annonce</button>`);
  }else{
    window.location.href=result.paymentUrl;
  }
}

async function checkReturnFromPayment(){
  const params=new URLSearchParams(window.location.search);
  const packId=params.get("pack");
  const boostId=params.get("boost");
  const orderId=params.get("order");

  if(packId){
    const r=await fetch(`/api/packs/${packId}`);
    const pack=await r.json();
    history.replaceState(null,"","/");
    if(pack.payment_status==="paid"){
      openModal(`<h2>✅ Paiement confirmé</h2><p class="notice">Votre pack de ${pack.slots_total} annonces est actif pour 48h.</p><button class="safe" onclick="closeModal();openPublishForm(${pack.id})">Publier ma première annonce</button>`);
    }else{
      openModal(`<h2>⏳ Paiement en attente</h2><p class="notice">Si vous venez de payer, patientez quelques secondes puis réessayez "+ Vendre".</p>`);
    }
  }

  if(boostId){
    history.replaceState(null,"","/");
    openModal(`<h2>✅ Mise en avant</h2><p class="notice">Si le paiement est confirmé, votre annonce apparaît maintenant en tête de liste.</p>`);
    loadListings();
  }

  if(orderId){
    history.replaceState(null,"","/");
    openModal(`<h2>✅ Achat protégé</h2><p class="notice">Si le paiement est confirmé, le vendeur a été informé. Contactez-le pour organiser la remise. Vous avez 48h pour signaler un problème si besoin.</p><button class="secondary" onclick="reportIssue(${orderId})">Signaler un problème</button>`);
  }
}

function reportIssue(orderId){
  const reason=prompt("Décrivez le problème rencontré (objet non reçu, non conforme...) :");
  if(!reason)return;
  fetch(`/api/orders/${orderId}/dispute`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({reason})})
    .then(r=>r.json())
    .then(result=>{
      if(result.success){alert("Signalement envoyé. Le paiement au vendeur est suspendu en attendant vérification.");closeModal();}
      else alert(result.error||"Impossible d'envoyer le signalement.");
    });
}

function openPublishForm(packId){
  openModal(`<h2>Publier une annonce</h2>
  <form class="form" id="publishForm">
    <input type="hidden" name="packId" value="${packId}">
    <input class="field" name="title" required placeholder="Nom du produit">
    <select class="field" name="category">${categories.slice(1).map(c=>`<option>${c}</option>`).join("")}</select>
    <input class="field" name="price" type="number" min="0" required placeholder="Prix en F CFA">
    <select class="field" name="zone">${communes.map(c=>`<option>${c}</option>`).join("")}</select>
    <input class="field" name="phone" required placeholder="Téléphone" value="${localStorage.getItem("bp229_phone")||""}">
    <textarea class="field" name="description" placeholder="Description"></textarea>
    <label>Photos (jusqu'à 3)</label>
    <input class="field" name="images" type="file" accept="image/*" multiple>
    <label style="font-size:.85rem"><input type="checkbox" required> J'accepte les <a href="/cgu" target="_blank">CGU</a> de BON PLAN 229</label>
    <button class="safe">Publier cette annonce</button>
  </form>`);
  document.getElementById("publishForm").addEventListener("submit",publish);
}

async function publish(e){
  e.preventDefault();
  const r=await fetch("/api/listings",{method:"POST",body:new FormData(e.target)});
  const result=await r.json();
  if(!r.ok)return alert(result.error);
  closeModal();loadListings();alert("Annonce publiée.");
}

// ---------- Mise en avant (boost) ----------

function openBoost(listingId){
  openModal(`<h2>⭐ Mettre en avant</h2>
  <p class="notice">Votre annonce apparaît en tête de liste.</p>
  <form class="form" id="boostForm">
    <label><input type="radio" name="tier" value="72h" checked> 72h — 500 F CFA</label>
    <label><input type="radio" name="tier" value="7d"> 7 jours — 1000 F CFA</label>
    <button class="safe">Payer et mettre en avant</button>
  </form>`);
  document.getElementById("boostForm").addEventListener("submit",e=>buyBoost(e,listingId));
}

async function buyBoost(e,listingId){
  e.preventDefault();
  const tier=new FormData(e.target).get("tier");
  const r=await fetch(`/api/listings/${listingId}/boost`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({tier})});
  const result=await r.json();
  if(!r.ok)return alert(result.error);
  window.location.href=result.paymentUrl;
}

// ---------- Mes annonces ----------

function openMyListings(){
  openModal(`<h2>Mes annonces</h2>
  <form class="form" id="myForm">
    <input class="field" name="phone" required placeholder="Votre téléphone" value="${localStorage.getItem("bp229_phone")||""}">
    <button class="safe">Voir mes annonces</button>
  </form>
  <div id="myListings"></div>`);
  document.getElementById("myForm").addEventListener("submit",loadMyListings);
}

async function loadMyListings(e){
  e.preventDefault();
  const phone=new FormData(e.target).get("phone");
  localStorage.setItem("bp229_phone",phone);
  const r=await fetch("/api/listings/mine?phone="+encodeURIComponent(phone));
  const a=await r.json();
  document.getElementById("myListings").innerHTML=a.length?a.map(x=>`
    <div class="notice">
      <strong>${esc(x.title)}</strong> — ${money(x.price)}<br>
      Statut : ${x.status} ${x.boost_until&&new Date(x.boost_until)>new Date()?"⭐ en avant":""}<br>
      <button onclick="openBoost(${x.id})">⭐ Mettre en avant</button>
    </div>
  `).join(""):"<p>Aucune annonce trouvée pour ce numéro.</p>";
}

// ---------- Contact / achat protégé (avec commission) / recherche ----------

function contact(phone){
  openModal(`<h2>Contacter le vendeur</h2><div class="notice">Téléphone : <strong>${esc(decodeURIComponent(phone))}</strong></div><p>Pour une transaction protégée, utilisez le parcours d'achat sécurisé.</p>`);
}

function protectedPurchase(listingId,price){
  openModal(`<h2>🛡️ Achat protégé</h2>
  <p class="notice">Montant : <strong>${money(price)}</strong>. Le paiement est sécurisé via FedaPay. Les fonds sont conservés 48h après paiement pendant lesquelles vous pouvez signaler un problème si l'objet n'est pas reçu comme prévu.</p>
  <form class="form" id="purchaseForm">
    <input class="field" name="buyerPhone" required placeholder="Votre téléphone">
    <label style="font-size:.85rem"><input type="checkbox" required> J'accepte les <a href="/cgu" target="_blank">CGU</a> de BON PLAN 229</label>
    <button class="safe">Payer et réserver</button>
  </form>`);
  document.getElementById("purchaseForm").addEventListener("submit",e=>buyProtected(e,listingId));
}

async function buyProtected(e,listingId){
  e.preventDefault();
  const buyerPhone=new FormData(e.target).get("buyerPhone");
  const r=await fetch(`/api/listings/${listingId}/purchase`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({buyerPhone})});
  const result=await r.json();
  if(!r.ok)return alert(result.error);
  window.location.href=result.paymentUrl;
}

function openSearch(){
  openModal(`<h2>🔎 Je cherche</h2><form class="form" onsubmit="event.preventDefault();alert('Demande enregistrée dans le prototype.');closeModal()"><textarea class="field" required placeholder="Ex. Je cherche une moto à moins de 350 000 F"></textarea><input class="field" required placeholder="Votre téléphone"><button class="safe">Envoyer</button></form>`);
}

function openModal(content){document.getElementById("modalContent").innerHTML=content;document.getElementById("modal").classList.remove("hidden");}
function closeModal(){document.getElementById("modal").classList.add("hidden");}

renderCategories();
renderZones();
loadListings();
checkReturnFromPayment();
