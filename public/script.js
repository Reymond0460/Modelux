/* ══════════════════════════════════════════════════
   FIREBASE — configuración de tu proyecto
   Si cambias de proyecto Firebase, edita aquí
══════════════════════════════════════════════════ */
const firebaseConfig = {
  apiKey:            "AIzaSyBxki8jnav8YWuykhC_iuLHAhKMhjOlwL0",
  authDomain:        "happypocket-5b7e9.firebaseapp.com",
  projectId:         "happypocket-5b7e9",
  storageBucket:     "happypocket-5b7e9.firebasestorage.app",
  messagingSenderId: "935261817390",
  appId:             "1:935261817390:web:e63f9fccb208cf9f2aadbf"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();
const PRODUCTS_COL = 'productos'; // nombre de la colección en Firestore

/* ══════════════════════════════════════════════════
   SESIÓN ADMIN — Firebase Authentication (correo + contraseña)
   El permiso real de escritura lo da firestore.rules;
   isAdmin solo controla qué se muestra en pantalla.
══════════════════════════════════════════════════ */
let isAdmin = false;

/* ══════════════════════════════════════════════════
   COMPRESIÓN DE IMAGEN CON CANVAS
   Máx 700px · calidad 0.65 → ~40-80 KB por imagen
   (necesario para el límite de 1 MB de Firestore)
══════════════════════════════════════════════════ */
function compressImage(file, maxPx = 700, quality = 0.65) {
  return new Promise(res => {
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        let { width: w, height: h } = img;
        if (w > maxPx || h > maxPx) {
          if (w > h) { h = Math.round(h * maxPx / w); w = maxPx; }
          else       { w = Math.round(w * maxPx / h); h = maxPx; }
        }
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        res(c.toDataURL('image/jpeg', quality));
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

/* ══════════════════════════════════════════════════
   ESTADO GLOBAL
══════════════════════════════════════════════════ */
let products       = [];      // cache local de Firestore
let cart           = JSON.parse(localStorage.getItem('modelux_cart') || '[]');
let uploadedImages = [];
let selectedSizes  = [];
let customSizes    = [];
let pendingProduct = null;
let pendingSize    = null;
let editingProductId = null;  // ID de la prenda que se está editando (null = modo agregar)
let currentFilter  = 'all';
let currentCat     = 'all';
let searchQuery    = '';
let sortMode       = 'new';
let onlyFavs       = false;
let favs           = new Set();
try { favs = new Set(JSON.parse(localStorage.getItem('modelux_favs') || '[]')); } catch (e) {}
function saveFavs() { try { localStorage.setItem('modelux_favs', JSON.stringify([...favs])); } catch (e) {} }
const SITE_URL = 'https://happypocket-5b7e9.web.app';
const WA_NUMBER = '56940916058'; // Tu número fijo de WhatsApp (sin + ni espacios)
let unsubscribe    = null;    // listener de Firestore en tiempo real

const DEFAULT_SIZES = ['XXS','XS','S','M','L','XL','XXL','XXXL'];
const MAX_IMAGES    = 3;

/* ══════════════════════════════════════════════════
   ARRANQUE
══════════════════════════════════════════════════ */
function init() {
  applyRole();
  renderCart();
  updateCartCount();
  startRealtimeListener();  // escucha cambios en Firestore en tiempo real
  // Firebase recuerda la sesión; esto la restaura o la cierra
  auth.onAuthStateChanged(user => {
    const was = isAdmin;
    isAdmin = !!user;
    applyRole();
    if (isAdmin && !was) initSizeChips();
    renderProducts();
  });
}

/* ══════════════════════════════════════════════════
   FIRESTORE — LISTENER EN TIEMPO REAL
   Cada vez que el admin agrega o elimina un producto,
   TODOS los clientes ven el cambio sin recargar
══════════════════════════════════════════════════ */
function startRealtimeListener() {
  if (unsubscribe) unsubscribe();

  unsubscribe = db.collection(PRODUCTS_COL)
    .orderBy('createdAt', 'desc')
    .onSnapshot(snapshot => {
      products = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      renderProducts();
      hideLoader();
      openLinkedProduct();
    }, err => {
      console.error('Firestore error:', err);
      showToast('Error al conectar con la base de datos');
      hideLoader();
    });
}

/* Enlace ?p=ID (viene en los pedidos de WhatsApp): muestra la foto de esa prenda */
let linkedHandled = false;
function openLinkedProduct() {
  if (linkedHandled) return;
  const id = new URLSearchParams(location.search).get('p');
  if (!id) { linkedHandled = true; return; }
  const p = products.find(x => x.id === id);
  linkedHandled = true;
  if (!p) return showToast('Esa prenda ya no está disponible');
  if (p.images && p.images.length) openImgModal(p.images[0]);
  else showToast(p.name + ' · ' + p.brand);
}

function hideLoader() {
  const loader = document.getElementById('pageLoader');
  loader.classList.add('hidden');
  setTimeout(() => loader.style.display = 'none', 400);
}

/* ══════════════════════════════════════════════════
   ROLES — header según si es admin o usuario
══════════════════════════════════════════════════ */
function applyRole() {
  const hr = document.getElementById('headerRight');
  const favBtn = `<button class="fav-toggle" id="favToggle" aria-pressed="${onlyFavs}" onclick="toggleOnlyFavs()">♡<span class="hide-m"> Favoritos</span> <span class="fav-count" id="favCount">${favs.size}</span></button>`;
  if (isAdmin) {
    document.body.classList.add('admin-mode');
    hr.innerHTML = `
      <span class="admin-badge">Admin</span>
      <button class="tab-btn active" id="btnTienda" onclick="switchTab('tienda')">Tienda</button>
      <button class="tab-btn" id="btnAdmin" onclick="switchTab('admin')">+ Agregar</button>
      ${favBtn}
      <button class="cart-btn" onclick="openCart()">Carrito <span class="cart-count" id="cartCount">0</span></button>
      <button class="btn-logout" onclick="logout()">Salir</button>`;
    document.getElementById('adminLink').style.display = 'none';
  } else {
    document.body.classList.remove('admin-mode');
    hr.innerHTML = `
      ${favBtn}
      <button class="cart-btn" onclick="openCart()">Carrito <span class="cart-count" id="cartCount">0</span></button>`;
    document.getElementById('adminLink').style.display = 'inline';
    switchTab('tienda');
  }
  updateCartCount();
}

function toggleOnlyFavs() {
  onlyFavs = !onlyFavs;
  const b = document.getElementById('favToggle');
  if (b) b.setAttribute('aria-pressed', onlyFavs);
  renderProducts();
}
function toggleFav(id) {
  favs.has(id) ? favs.delete(id) : favs.add(id);
  saveFavs();
  const c = document.getElementById('favCount'); if (c) c.textContent = favs.size;
  renderProducts();
}

function switchTab(tab) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  const bT = document.getElementById('btnTienda');
  const bA = document.getElementById('btnAdmin');
  if (bT) bT.classList.toggle('active', tab === 'tienda');
  if (bA) bA.classList.toggle('active', tab === 'admin');
}

/* ══════════════════════════════════════════════════
   LOGIN / LOGOUT
══════════════════════════════════════════════════ */
function openLogin() {
  document.getElementById('loginUser').value = '';
  document.getElementById('loginPass').value = '';
  document.getElementById('loginErr').classList.remove('show');
  document.getElementById('loginModal').classList.add('open');
  setTimeout(() => document.getElementById('loginUser').focus(), 80);
}
function closeLogin() {
  document.getElementById('loginModal').classList.remove('open');
}
async function doLogin() {
  const email = document.getElementById('loginUser').value.trim();
  const pass  = document.getElementById('loginPass').value;
  try {
    await auth.signInWithEmailAndPassword(email, pass);
    closeLogin();
    showToast('✦ Bienvenido al panel de administración');
  } catch (e) {
    console.error('Login:', e.code, e.message);
    const msgs = {
      'auth/operation-not-allowed': 'El acceso con correo y contraseña no está activado en Firebase.',
      'auth/network-request-failed': 'Sin conexión. Revisa tu internet.',
      'auth/too-many-requests': 'Demasiados intentos. Espera unos minutos.',
      'auth/invalid-email': 'El correo no es válido.',
      'auth/user-disabled': 'Esta cuenta está deshabilitada.'
    };
    const err = document.getElementById('loginErr');
    err.textContent = msgs[e.code] || 'Correo o contraseña incorrectos';
    err.classList.add('show');
    document.getElementById('loginPass').value = '';
    document.getElementById('loginPass').focus();
  }
}
async function logout() {
  if (!confirm('¿Cerrar sesión de administrador?')) return;
  await auth.signOut();
  showToast('Sesión cerrada');
}
async function changePassword() {
  const user = auth.currentUser;
  if (!user) return;
  try {
    await auth.sendPasswordResetEmail(user.email);
    showToast('✦ Te enviamos un correo para cambiar la contraseña');
  } catch (e) {
    showToast('⚠ No se pudo enviar el correo');
  }
}

/* ══════════════════════════════════════════════════
   PRECIO
══════════════════════════════════════════════════ */
function onPriceInput(input) {
  const raw = input.value.replace(/\D/g, '');
  input.value = raw;
  document.getElementById('priceHint').textContent =
    raw ? '→ $' + parseInt(raw, 10).toLocaleString('es-CL') : '';
}
function parsePrice(val) {
  const n = parseFloat(String(val).replace(/[.\s]/g, '').replace(',', '.'));
  return isNaN(n) ? null : n;
}

/* ══════════════════════════════════════════════════
   TALLAS
══════════════════════════════════════════════════ */
function initSizeChips() {
  const grid = document.getElementById('sizesGrid');
  if (!grid) return;
  grid.innerHTML = '';
  selectedSizes = []; customSizes = [];
  DEFAULT_SIZES.forEach(s => appendSzChip(s, false));
}
function appendSzChip(size, selected) {
  const chip = document.createElement('div');
  chip.className   = 'sz-chip' + (selected ? ' on' : '');
  chip.textContent = size;
  chip.onclick = () => {
    const on = chip.classList.toggle('on');
    if (on) selectedSizes.push(size);
    else    selectedSizes = selectedSizes.filter(s => s !== size);
  };
  document.getElementById('sizesGrid').appendChild(chip);
}
function addCustomSize() {
  const input = document.getElementById('customSizeInput');
  const val   = input.value.trim().toUpperCase();
  if (!val) return;
  if (customSizes.includes(val) || DEFAULT_SIZES.includes(val))
    return showToast('Esa talla ya existe');
  customSizes.push(val); selectedSizes.push(val);
  appendSzChip(val, true);
  input.value = '';
}

/* ══════════════════════════════════════════════════
   IMÁGENES
══════════════════════════════════════════════════ */
async function handleImages(input) {
  const files = Array.from(input.files);
  for (const file of files) {
    if (uploadedImages.length >= MAX_IMAGES) {
      showToast('⚠ Máximo ' + MAX_IMAGES + ' imágenes por producto'); break;
    }
    showToast('Comprimiendo imagen...');
    uploadedImages.push(await compressImage(file));
    renderPreview();
  }
  input.value = '';
}
function renderPreview() {
  const grid = document.getElementById('previewGrid');
  if (!grid) return;
  grid.innerHTML = '';
  uploadedImages.forEach((src, i) => {
    const wrap = document.createElement('div'); wrap.className = 'preview-thumb';
    const img  = document.createElement('img');  img.src = src;
    const btn  = document.createElement('button'); btn.className = 'rm-img'; btn.textContent = '✕';
    btn.onclick = () => { uploadedImages.splice(i, 1); renderPreview(); };
    wrap.append(img, btn); grid.appendChild(wrap);
  });
}

async function addProduct() {
  if (!isAdmin) return;
  const name  = document.getElementById('productName').value.trim();
  const brand = document.getElementById('productBrand').value.trim();
  const price = parsePrice(document.getElementById('productPrice').value);
  const cat   = document.getElementById('productCategory').value;
  const desc  = document.getElementById('productDesc').value.trim();

  if (!name)             return showToast('⚠ Ingresa el nombre');
  if (!brand)            return showToast('⚠ Ingresa la marca');
  if (!price||price<=0)  return showToast('⚠ Ingresa un precio válido');

  const btnAdd = document.getElementById('btnAdd');
  const bar    = document.getElementById('savingBar');
  btnAdd.disabled = true; bar.classList.add('show');

  try {
    if (editingProductId) {
      // ─── MODO EDITAR ───
      const updates = {
        name, brand, price, cat, desc,
        images: [...uploadedImages],
        sizes:  [...selectedSizes]
      };
      await db.collection(PRODUCTS_COL).doc(editingProductId).update(updates);
      showToast('✦ Prenda actualizada correctamente');
      cancelEdit();
    } else {
      // ─── MODO AGREGAR ───
      const product = {
        name, brand, price, cat, desc,
        images:    [...uploadedImages],
        sizes:     [...selectedSizes],
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      await db.collection(PRODUCTS_COL).add(product);
      showToast('✦ Prenda guardada en la nube correctamente');
      resetForm();
    }
    switchTab('tienda');
  } catch (e) {
    console.error(e);
    if (e.code === 'resource-exhausted') {
      showToast('❌ Documento demasiado grande. Usa menos imágenes.');
    } else {
      showToast('❌ Error al guardar: ' + e.message);
    }
  } finally {
    btnAdd.disabled = false; bar.classList.remove('show');
  }
}

/* ══════════════════════════════════════════════════
   LIMPIAR FORMULARIO
══════════════════════════════════════════════════ */
function resetForm() {
  ['productName','productBrand','productPrice','productDesc'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const ph = document.getElementById('priceHint');
  if (ph) ph.textContent = '';
  uploadedImages = [];
  renderPreview();
  initSizeChips();
}

/* ══════════════════════════════════════════════════
   EDITAR PRODUCTO
══════════════════════════════════════════════════ */
function editProduct(productId) {
  if (!isAdmin) return;
  const p = products.find(x => x.id === productId);
  if (!p) return showToast('Prenda no encontrada');

  editingProductId = productId;

  // Cargar datos en el formulario
  document.getElementById('productName').value     = p.name || '';
  document.getElementById('productBrand').value    = p.brand || '';
  document.getElementById('productPrice').value    = p.price || '';
  document.getElementById('productCategory').value = p.cat || 'Mujer';
  document.getElementById('productDesc').value     = p.desc || '';

  // Disparar hint del precio
  onPriceInput(document.getElementById('productPrice'));

  // Cargar imágenes
  uploadedImages = [...(p.images || [])];
  renderPreview();

  // Cargar tallas: reiniciar y marcar las que tiene
  initSizeChips();
  selectedSizes = [];
  customSizes   = [];

  (p.sizes || []).forEach(s => {
    if (DEFAULT_SIZES.includes(s)) {
      // Marcar el chip existente
      const chips = document.querySelectorAll('#sizesGrid .sz-chip');
      chips.forEach(chip => {
        if (chip.textContent === s) {
          chip.classList.add('on');
          selectedSizes.push(s);
        }
      });
    } else {
      // Crear chip personalizado
      customSizes.push(s);
      selectedSizes.push(s);
      appendSzChip(s, true);
    }
  });

  // Cambiar UI a modo edición
  document.getElementById('panelTitle').textContent = 'Editar Prenda';
  document.getElementById('panelSub').textContent   = 'Modifica los datos y guarda los cambios';
  document.getElementById('btnAdd').innerHTML        = '💾 Guardar cambios';
  document.getElementById('btnCancelEdit').style.display = 'block';

  // Cambiar al tab admin y scrollear arriba
  switchTab('admin');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function cancelEdit() {
  editingProductId = null;
  resetForm();
  // Restaurar UI a modo agregar
  document.getElementById('panelTitle').textContent = 'Agregar Prenda';
  document.getElementById('panelSub').textContent   = 'Sube las fotos y completa los datos del producto';
  document.getElementById('btnAdd').innerHTML        = '✦ Agregar a la tienda';
  document.getElementById('btnCancelEdit').style.display = 'none';
}

function resetForm() {
  ['productName','productBrand','productPrice','productDesc'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const ph = document.getElementById('priceHint'); if (ph) ph.textContent = '';
  uploadedImages = []; renderPreview(); initSizeChips();
}
/* ══════════════════════════════════════════════════
   ELIMINAR PRODUCTO → Firestore
══════════════════════════════════════════════════ */
async function deleteProduct(id) {
  if (!isAdmin) return;
  if (!confirm('¿Eliminar esta prenda? Esta acción no se puede deshacer.')) return;
  try {
    await db.collection(PRODUCTS_COL).doc(id).delete();
    showToast('Prenda eliminada');
  } catch (e) {
    console.error(e);
    showToast('❌ Error al eliminar');
  }
}

/* ══════════════════════════════════════════════════
   RENDER PRODUCTOS
══════════════════════════════════════════════════ */
function filteredProducts() {
  const q = searchQuery.trim().toLowerCase();
  const r = products.filter(p =>
    (currentFilter === 'all' || p.brand === currentFilter) &&
    (currentCat === 'all' || p.cat === currentCat) &&
    (!q || ((p.name || '') + ' ' + (p.brand || '')).toLowerCase().includes(q)) &&
    (!onlyFavs || favs.has(p.id)));
  if (sortMode === 'lo') r.sort((a, b) => a.price - b.price);
  if (sortMode === 'hi') r.sort((a, b) => b.price - a.price);
  return r;
}

function renderProducts(brandFilter) {
  if (brandFilter !== undefined) currentFilter = brandFilter;
  const grid  = document.getElementById('productsGrid');
  const count = document.getElementById('productCount');
  grid.innerHTML = '';

  const filtered = filteredProducts();
  count.textContent = `${filtered.length} prenda${filtered.length !== 1 ? 's' : ''} disponible${filtered.length !== 1 ? 's' : ''}`;

  if (!filtered.length) {
    const es = document.createElement('div'); es.className = 'empty-state';
    const filtering = products.length && (searchQuery || onlyFavs || currentFilter !== 'all' || currentCat !== 'all');
    es.innerHTML = '<div class="big-icon">👗</div>';
    es.appendChild(mk('p', '', filtering ? 'Nada por aquí' : 'No hay prendas aún'));
    es.appendChild(mk('small', '', filtering ? 'Prueba con otra marca o borra la búsqueda.'
      : (isAdmin ? 'Ve a "+ Agregar" para empezar.' : 'Vuelve pronto.')));
    grid.appendChild(es);
    updateFilterBar(); return;
  }

  filtered.forEach((p, idx) => {
    const card = document.createElement('div');
    card.className = 'product-card';
    card.style.animationDelay = Math.min(idx, 12) * 0.04 + 's';

    const media = mk('div', 'product-media');
    let imgEl;
    if (p.images && p.images.length) {
      imgEl = document.createElement('img');
      imgEl.className = 'product-img'; imgEl.src = p.images[0]; imgEl.alt = p.name;
      imgEl.loading   = 'lazy';
      imgEl.addEventListener('click', () => openImgModal(p.images[0]));
    } else {
      imgEl = mk('div', 'product-img-placeholder', '👗');
    }
    const fav = mk('button', 'fav-btn', favs.has(p.id) ? '♥' : '♡');
    fav.setAttribute('aria-pressed', favs.has(p.id));
    fav.setAttribute('aria-label', 'Favorito');
    fav.addEventListener('click', () => toggleFav(p.id));
    media.append(imgEl, fav);

    const info = mk('div', 'product-info');
    const brandEl = mk('div','product-brand', p.brand);
    const nameEl  = mk('div','product-name',  p.name);
    const priceEl = mk('div','product-price', '$' + Number(p.price).toLocaleString('es-CL'));

    const sizesDiv = mk('div', 'product-sizes');
    (p.sizes && p.sizes.length ? p.sizes : ['Sin tallas']).forEach(s => sizesDiv.appendChild(mk('span', 'size-tag', s)));

    const actions = mk('div', 'card-actions');
    const btnCart = mk('button', 'btn-add-cart', 'Agregar');
    btnCart.addEventListener('click', () => openSizeModal(p.id));

    const btnEdit = mk('button', 'btn-edit', '✏️');
    btnEdit.title = 'Editar prenda'; btnEdit.setAttribute('aria-label', 'Editar');
    btnEdit.addEventListener('click', () => editProduct(p.id));

    const btnDel = mk('button', 'btn-delete', '🗑');
    btnDel.title = 'Eliminar prenda'; btnDel.setAttribute('aria-label', 'Eliminar');
    btnDel.addEventListener('click', () => deleteProduct(p.id));

    actions.append(btnCart, btnEdit, btnDel);
    info.append(brandEl, nameEl, priceEl, sizesDiv, actions);
    card.append(media, info);
    grid.appendChild(card);
  });

  updateFilterBar();
}

/* Helper para crear elementos rápido */
function mk(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls)  el.className   = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

/* ══════════════════════════════════════════════════
   FILTRO POR MARCA
══════════════════════════════════════════════════ */
function updateFilterBar() {
  const build = (el, label, values, current, onPick) => {
    el.innerHTML = '';
    [['Todas', 'all'], ...values.map(v => [v, v])].forEach(([text, val]) => {
      const c = mk('button', 'filter-chip' + (current === val ? ' active' : ''), text);
      c.onclick = () => onPick(val);
      el.appendChild(c);
    });
  };
  build(document.getElementById('filterBar'), 'Marca',
    [...new Set(products.map(p => p.brand).filter(Boolean))], currentFilter, v => renderProducts(v));
  build(document.getElementById('catBar'), 'Categoría',
    [...new Set(products.map(p => p.cat).filter(Boolean))], currentCat, v => { currentCat = v; renderProducts(); });
}

/* ══════════════════════════════════════════════════
   MODAL TALLA
══════════════════════════════════════════════════ */
function openSizeModal(productId) {
  pendingProduct = products.find(p => p.id === productId);
  if (!pendingProduct) return;
  pendingSize = null;
  if (!pendingProduct.sizes || !pendingProduct.sizes.length) {
    addToCart(pendingProduct, 'Única'); return;
  }
  document.getElementById('sizeModalName').textContent = pendingProduct.name;
  const container = document.getElementById('modalSizes'); container.innerHTML = '';
  pendingProduct.sizes.forEach(s => {
    const btn = mk('button', 'ms-btn', s);
    btn.addEventListener('click', () => {
      container.querySelectorAll('.ms-btn').forEach(b => b.classList.remove('on'));
      btn.classList.add('on'); pendingSize = s;
    });
    container.appendChild(btn);
  });
  if (pendingProduct.sizes.length === 1) {
    container.querySelector('.ms-btn').classList.add('on');
    pendingSize = pendingProduct.sizes[0];
  }
  document.getElementById('sizeModal').classList.add('open');
}
function closeSizeModal() {
  document.getElementById('sizeModal').classList.remove('open');
  pendingProduct = null; pendingSize = null;
}
function confirmAddToCart() {
  if (!pendingProduct) return;
  if (!pendingSize) return showToast('⚠ Selecciona una talla');
  addToCart(pendingProduct, pendingSize);
  closeSizeModal();
}

/* ══════════════════════════════════════════════════
   CARRITO
══════════════════════════════════════════════════ */
function addToCart(product, size) {
  const key = product.id + '__' + size;
  const ex  = cart.find(i => i.key === key);
  if (ex) { ex.qty++; }
  else {
    cart.push({ key, id: product.id, name: product.name, brand: product.brand,
      price: product.price, size, qty: 1,
      image: (product.images && product.images[0]) || null });
  }
  saveCart(); renderCart(); updateCartCount();
  openCart();
  showToast('✦ ' + product.name + ' (' + size + ') agregado');
}

function renderCart() {
  const body   = document.getElementById('cartBody');
  const footer = document.getElementById('cartFooter');
  body.innerHTML = '';
  if (!cart.length) {
    const m = mk('div', 'cart-empty-msg');
    m.innerHTML = '<div class="big">🛒</div><p>Tu carrito está vacío</p>';
    body.appendChild(m); footer.style.display = 'none'; return;
  }
  footer.style.display = 'block';
  cart.forEach(item => {
    const row = mk('div', 'cart-item');
    let imgEl;
    if (item.image) { imgEl = mk('img','ci-img'); imgEl.src=item.image; imgEl.alt=item.name; }
    else            { imgEl = mk('div','ci-ph','👗'); }
    const det  = mk('div','ci-details');
    const br   = mk('div','ci-brand',  item.brand);
    const nm   = mk('div','ci-name',   item.name);
    const sz   = mk('div','ci-size',   'Talla: ' + item.size);
    const pr   = mk('div','ci-price',  '$' + (item.price * item.qty).toLocaleString('es-CL'));
    const qc   = mk('div','qty-ctrl');
    const bm   = mk('button','qty-btn','−'); bm.addEventListener('click',()=>changeQty(item.key,-1));
    const qn   = mk('span','qty-n', item.qty);
    const bp   = mk('button','qty-btn','+'); bp.addEventListener('click',()=>changeQty(item.key,1));
    qc.append(bm,qn,bp); det.append(br,nm,sz,pr,qc);
    const rm = mk('button','ci-remove','✕');
    rm.addEventListener('click',()=>removeFromCart(item.key));
    row.append(imgEl,det,rm); body.appendChild(row);
  });
  document.getElementById('cartTotal').textContent =
    '$' + cart.reduce((s,i)=>s+i.price*i.qty,0).toLocaleString('es-CL');
}

function changeQty(key,delta){
  const item=cart.find(i=>i.key===key); if(!item) return;
  item.qty+=delta; if(item.qty<=0) cart=cart.filter(i=>i.key!==key);
  saveCart(); renderCart(); updateCartCount();
}
function removeFromCart(key){
  cart=cart.filter(i=>i.key!==key); saveCart(); renderCart(); updateCartCount();
}
function updateCartCount(){
  const n=cart.reduce((s,i)=>s+i.qty,0), t=cart.reduce((s,i)=>s+i.price*i.qty,0);
  document.querySelectorAll('#cartCount').forEach(el=>{ el.textContent=n; });
  document.getElementById('cbN').textContent='Ver pedido · '+n+(n===1?' prenda':' prendas');
  document.getElementById('cbT').textContent='$'+t.toLocaleString('es-CL');
  syncCartBar();
}
function syncCartBar(){
  const open=document.getElementById('cartSidebar').classList.contains('open')
    || document.querySelector('.backdrop.open');
  document.getElementById('cartBar').classList.toggle('show', cart.length>0 && !open);
}
function saveCart(){
  try { localStorage.setItem('modelux_cart',JSON.stringify(cart)); }
  catch(e){
    try { localStorage.setItem('modelux_cart',JSON.stringify(cart.map(i=>({...i,image:null})))); }
    catch(e2){ console.warn('Cart save failed'); }
  }
}
function openCart(){
  document.getElementById('cartSidebar').classList.add('open');
  document.getElementById('cartOverlay').classList.add('open');
  document.body.classList.add('lock'); syncCartBar();
}
function closeCart(){
  document.getElementById('cartSidebar').classList.remove('open');
  document.getElementById('cartOverlay').classList.remove('open');
  document.body.classList.remove('lock'); syncCartBar();
}

/* ══════════════════════════════════════════════════
   CHECKOUT + WHATSAPP
══════════════════════════════════════════════════ */
function checkout(){
  if(!cart.length) return showToast('⚠ Tu carrito está vacío');
  closeCart(); renderCheckout();
  document.getElementById('checkoutModal').classList.add('open');
}
function closeCheckout(){
  document.getElementById('checkoutModal').classList.remove('open');
}
function renderCheckout(){
  const container=document.getElementById('coItems'); container.innerHTML='';
  cart.forEach(item=>{
    const row=mk('div','co-item');
    let imgEl;
    if(item.image){imgEl=mk('img','co-img');imgEl.src=item.image;imgEl.alt=item.name;}
    else{imgEl=mk('div','co-ph','👗');}
    const info=mk('div','co-info');
    info.append(mk('div','co-brand',item.brand),
      mk('div','co-name',item.name),
      mk('div','co-meta','Talla: '+item.size+' · Cantidad: '+item.qty));
    const pr=mk('div','co-price','$'+(item.price*item.qty).toLocaleString('es-CL'));
    row.append(imgEl,info,pr); container.appendChild(row);
  });
  const total=cart.reduce((s,i)=>s+i.price*i.qty,0);
  const qty  =cart.reduce((s,i)=>s+i.qty,0);
  document.getElementById('coTotalAmt').textContent   ='$'+total.toLocaleString('es-CL');
  document.getElementById('coTotalItems').textContent =qty+' producto'+(qty!==1?'s':'');
}
function sendToWhatsApp(){
  const phone=WA_NUMBER;
  const lines=['🛍 *Nuevo pedido — MODELUX*',''];
  cart.forEach((item,i)=>{
    lines.push(`*${i+1}. ${item.name}*`,
      `   Marca: ${item.brand}`,`   Talla: ${item.size}`,
      `   Cantidad: ${item.qty}`,
      `   Ver foto: ${SITE_URL}/?p=${item.id}`,
      `   Subtotal: $${(item.price*item.qty).toLocaleString('es-CL')}`,'');
  });
  const total=cart.reduce((s,i)=>s+i.price*i.qty,0);
  const qty  =cart.reduce((s,i)=>s+i.qty,0);
  lines.push('─────────────────',
    `*Total: $${total.toLocaleString('es-CL')}* (${qty} producto${qty!==1?'s':''})`,
    '','¡Hola! Me gustaría hacer este pedido. ¿Me confirmas disponibilidad? 😊');
  window.open('https://wa.me/'+phone+'?text='+encodeURIComponent(lines.join('\n')),'_blank');
}

/* ══════════════════════════════════════════════════
   MODAL IMAGEN GRANDE
══════════════════════════════════════════════════ */
function openImgModal(src){
  document.getElementById('imgModalSrc').src=src;
  document.getElementById('imgModal').classList.add('open');
}
function closeImgModal(){
  document.getElementById('imgModal').classList.remove('open');
}

/* ══════════════════════════════════════════════════
   TOAST
══════════════════════════════════════════════════ */
let toastTimer;
function showToast(msg){
  const el=document.getElementById('toast');
  el.textContent=msg; el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>el.classList.remove('show'),2800);
}

/* ══════════════════════════════════════════════════
   ATAJOS DE TECLADO
══════════════════════════════════════════════════ */
document.addEventListener('keydown', e=>{
  if(e.key==='Escape'){ closeImgModal();closeSizeModal();closeCart();closeCheckout();closeLogin(); }
});

/* ══════════════════════════════════════════════════
   DRAG & DROP imágenes
══════════════════════════════════════════════════ */
const zone = document.getElementById('uploadZone');
if (zone) {
  zone.addEventListener('dragover',  e=>{e.preventDefault();zone.classList.add('drag');});
  zone.addEventListener('dragleave', ()=>zone.classList.remove('drag'));
  zone.addEventListener('drop', async e=>{
    e.preventDefault(); zone.classList.remove('drag');
    for(const file of Array.from(e.dataTransfer.files).filter(f=>f.type.startsWith('image/'))){
      if(uploadedImages.length>=MAX_IMAGES){showToast('⚠ Máximo '+MAX_IMAGES+' imágenes');break;}
      uploadedImages.push(await compressImage(file)); renderPreview();
    }
  });
}

/* ══════════════════════════════════════════════════
   ARRANCAR LA APLICACIÓN
══════════════════════════════════════════════════ */
document.getElementById('searchInput').addEventListener('input', e => { searchQuery = e.target.value; renderProducts(); });
document.getElementById('sortSelect').addEventListener('change', e => { sortMode = e.target.value; renderProducts(); });
init();

/* ══════════════════════════════════════════════════
   LIMPIAR FORMULARIO (función global)
══════════════════════════════════════════════════ */
function resetForm() {
  const ids = ['productName', 'productBrand', 'productPrice', 'productDesc'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const ph = document.getElementById('priceHint');
  if (ph) ph.textContent = '';
  uploadedImages = [];
  if (typeof renderPreview === 'function') renderPreview();
  if (typeof initSizeChips === 'function') initSizeChips();
}