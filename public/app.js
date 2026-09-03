const categories=["Tout","Téléphones","Motos","Maison","Mode","Services","Emploi","Autres"];
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
  return `<article class="card">
    <div class="image">${x.image?`<img src="${x.image}" alt="">`:"📦"}</div>
    <div class="body">
      <small>${esc(x.category)}</small>
      <h3>${esc(x.title)}</h3>
      <div class="price">${money(x.price)}</div>
      <div class="meta">📍 ${esc(x.zone)}</div>
      <p>${esc(x.description)}</p>
      <div class="actions">
        <button onclick="contact('${encodeURIComponent(x.phone)}')">Contacter</button>
        ${x.price>0?`<button class="safe" onclick="protectedPurchase(${x.id})">🛡️ Acheter</button>`:""}
      </div>
    </div>
  </article>`;
}

function openPublish(){
  openModal(`<h2>Publier une annonce</h2>
  <p class="notice">Première annonce gratuite pour le lancement. Le tarif cible ensuite est de 100 F.</p>
  <form class="form" id="publishForm">
    <input class="field" name="title" required placeholder="Nom du produit">
    <select class="field" name="category">${categories.slice(1).map(c=>`<option>${c}</option>`).join("")}</select>
    <input class="field" name="price" type="number" min="0" required placeholder="Prix en F CFA">
    <select class="field" name="zone"><option>Cotonou</option><option>Abomey-Calavi</option><option>Porto-Novo</option><option>Parakou</option><option>Ouidah</option></select>
    <input class="field" name="phone" required placeholder="Téléphone">
    <textarea class="field" name="description" placeholder="Description"></textarea>
    <input class="field" name="image" type="file" accept="image/*">
    <button class="safe">Publier</button>
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

function contact(phone){
  openModal(`<h2>Contacter le vendeur</h2><div class="notice">Téléphone : <strong>${esc(decodeURIComponent(phone))}</strong></div><p>Pour une transaction protégée, utilisez le parcours d'achat sécurisé lorsqu'il sera activé.</p>`);
}

function protectedPurchase(){
  openModal(`<h2>🛡️ Achat protégé</h2><div class="notice">Le paiement FedaPay et la gestion sécurisée de la transaction seront connectés dans l'étape suivante.</div>`);
}

function openSearch(){
  openModal(`<h2>🔎 Je cherche</h2><form class="form" onsubmit="event.preventDefault();alert('Demande enregistrée dans le prototype.');closeModal()"><textarea class="field" required placeholder="Ex. Je cherche une moto à moins de 350 000 F"></textarea><input class="field" required placeholder="Votre téléphone"><button class="safe">Envoyer</button></form>`);
}

function openModal(content){document.getElementById("modalContent").innerHTML=content;document.getElementById("modal").classList.remove("hidden");}
function closeModal(){document.getElementById("modal").classList.add("hidden");}

renderCategories();
loadListings();
