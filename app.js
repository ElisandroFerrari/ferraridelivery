import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./supabase-config.js";

const PAGE_SIZE = 9;
const HISTORY_PAGE_SIZE = 10;
const CART_STORAGE_KEY = "ferrari-delivery-cart-v1";
const THEME_STORAGE_KEY = "ferrari-delivery-theme-v1";
const AVATAR_BUCKET = "profile-photos";
const MAX_AVATAR_SIZE = 5 * 1024 * 1024;
const MASTER_ADMIN_ID = "0680c531-6f8e-4ad8-aae9-4de4206765ab";
const PAGE = document.body.dataset.page;
let hasShownConfigurationNotice = false;
const supabase = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;

const inFlight = new WeakSet();
const cart = readCart();
let activeUser = null;
let profile = null;
let addressSubmissionCreatesOrder = true;
let selectedAvatarFile = null;
let avatarPreviewUrl = null;
let avatarPositionX = 50;
let avatarPositionY = 50;
let avatarZoom = 1;
let themePreference = readTheme();
let shopSettings = null;

function readTheme() {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === "light" ? "light" : "dark";
  } catch (error) {
    console.error("Não foi possível ler a preferência de tema.", error);
    return "dark";
  }
}

function applyTheme(theme) {
  themePreference = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = themePreference;
  document.body.dataset.theme = themePreference;
  const toggle = document.querySelector("[data-theme-toggle]");
  const label = document.querySelector("[data-theme-label]");
  const icon = document.querySelector("[data-theme-icon]");
  if (toggle) toggle.setAttribute("aria-pressed", String(themePreference === "light"));
  if (label) label.textContent = themePreference === "light" ? "Usar tema escuro" : "Usar tema claro";
  if (icon) icon.textContent = themePreference === "light" ? "☾" : "☀";
}

applyTheme(themePreference);

function readCart() {
  try {
    const stored = JSON.parse(localStorage.getItem(CART_STORAGE_KEY) || "[]");
    if (!Array.isArray(stored)) return [];
    return stored.filter((item) =>
      item && typeof item.product_id === "string" && Number.isInteger(item.quantity) &&
      item.quantity > 0 && item.quantity <= 50 && Number.isFinite(item.price) && item.price > 0
    );
  } catch (error) {
    console.error("Não foi possível ler o carrinho salvo.", error);
    return [];
  }
}

function saveCart() {
  try {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
  } catch (error) {
    console.error("Não foi possível salvar o carrinho neste navegador.", error);
    showToast("Não foi possível manter o carrinho salvo neste navegador.");
  }
  renderCart();
}

function money(value) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value) || 0);
}

function showToast(message) {
  const region = document.querySelector("[data-toast]");
  if (!region) return;
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  region.append(toast);
  window.setTimeout(() => toast.remove(), 4800);
}

function setNotice(element, message, isError = false) {
  if (!element) return;
  element.textContent = message;
  element.hidden = false;
  element.classList.toggle("is-error", isError);
}

function clearNotice(element) {
  if (!element) return;
  element.textContent = "";
  element.hidden = true;
  element.classList.remove("is-error");
}

function friendlyError(error) {
  const code = [error?.code, error?.message, error?.details, error?.hint].filter(Boolean).join(" ");
  if (/store_settings|schema cache.*store_settings|table .*store_settings/i.test(code)) {
    return "A configuração de expediente ainda não foi aplicada. Execute supabase/migrations/20261101220000_shop_settings.sql no SQL Editor do Supabase.";
  }
  if (/avatar_path|neighborhood|city|schema cache|column .* does not exist/i.test(code)) {
    return "A atualização do perfil ainda não foi aplicada. Execute as migrações em supabase/migrations no SQL Editor do Supabase.";
  }
  if (/rate_limited/i.test(code)) return "Aguarde alguns segundos antes de enviar outro pedido.";
  if (/profile_required/i.test(code)) return "Complete seu nome, telefone, rua, número, bairro e cidade antes de pedir.";
  if (/invalid_cart|product_unavailable|promotion_unavailable/i.test(code)) return "Um item do carrinho mudou ou não está mais disponível. Atualize o cardápio e tente novamente.";
  if (/Invalid login credentials/i.test(code)) return "E-mail ou senha inválidos.";
  if (/Email not confirmed/i.test(code)) return "Confirme seu e-mail antes de entrar.";
  if (/duplicate key|already registered/i.test(code)) return "Este e-mail já possui uma conta.";
  if (/Failed to fetch|NetworkError/i.test(code)) return "Não foi possível conectar. Verifique sua internet e tente novamente.";
  return "Não foi possível concluir agora. Tente novamente em instantes.";
}

function configurationNotice() {
  if (hasShownConfigurationNotice) return;
  hasShownConfigurationNotice = true;
  const notice = document.createElement("div");
  notice.className = "notice setup-notice";
  notice.setAttribute("role", "status");
  notice.textContent = "Configure SUPABASE_URL e SUPABASE_ANON_KEY em supabase-config.js para ativar a aplicação. Nunca insira uma service_role key no navegador.";
  document.body.prepend(notice);
}

function withButtonLock(button, action) {
  if (inFlight.has(button)) return;
  inFlight.add(button);
  const wasDisabled = button.disabled;
  button.disabled = true;
  Promise.resolve().then(action).catch((error) => {
    console.error("Falha na operação.", error);
    showToast(friendlyError(error));
  }).finally(() => {
    button.disabled = wasDisabled;
    inFlight.delete(button);
  });
}

function safeImagePath(value) {
  if (typeof value !== "string" || !value.trim()) return "assets/logo.png";
  const path = value.trim();
  if (path.startsWith("assets/") && !path.includes("..") && !/["'();\\\u0000-\u001f]/.test(path)) return path;
  try {
    const url = new URL(path, window.location.origin);
    return url.protocol === "https:" ? url.href : "assets/logo.png";
  } catch {
    return "assets/logo.png";
  }
}

function imageElement(src, alt, className = "") {
  const image = document.createElement("img");
  image.src = safeImagePath(src);
  image.alt = alt;
  image.loading = "lazy";
  image.decoding = "async";
  if (className) image.className = className;
  image.addEventListener("error", () => { image.src = "assets/logo.png"; }, { once: true });
  return image;
}

async function requireSupabase() {
  if (!supabase) {
    configurationNotice();
    throw new Error("Supabase não está configurado.");
  }
}

async function roleForUser(user) {
  if (!user?.id) return "customer";
  if (user.id === MASTER_ADMIN_ID) return "admin";
  const { data, error } = await supabase.from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw error;
  return data?.role === "admin" ? "admin" : "customer";
}

async function routeForUser(user) {
  return await roleForUser(user) === "admin" ? "admin.html" : "cliente.html";
}

async function getCurrentUser() {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (!sessionData.session) return null;
  const { data, error } = await supabase.auth.getUser(sessionData.session.access_token);
  if (error) throw error;
  return data.user;
}

async function requireCustomer() {
  await requireSupabase();
  const user = await getCurrentUser();
  if (!user) {
    window.location.replace("login.html");
    return null;
  }
  if (await roleForUser(user) === "admin") {
    window.location.replace("admin.html");
    return null;
  }
  activeUser = user;
  return user;
}

async function requireAdmin() {
  await requireSupabase();
  const user = await getCurrentUser();
  if (!user) {
    window.location.replace("login.html");
    return null;
  }
  if (await roleForUser(user) !== "admin") {
    window.location.replace("cliente.html");
    return null;
  }
  activeUser = user;
  return user;
}

async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
  window.location.replace("index.html");
}

function bindSignOut() {
  document.querySelectorAll("[data-sign-out]").forEach((button) => {
    button.addEventListener("click", () => withButtonLock(button, signOut));
  });
}

async function initHome() {
  if (!supabase) return;
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (session?.user) window.location.replace(await routeForUser(session.user));
  } catch (error) {
    console.error("Não foi possível verificar a sessão.", error);
    showToast(friendlyError(error));
  }
}

function setAuthMode(mode) {
  document.querySelectorAll("[data-auth-mode]").forEach((tab) => {
    const active = tab.dataset.authMode === mode;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll("[data-auth-form]").forEach((form) => {
    form.hidden = form.dataset.authForm !== mode;
  });
  const title = document.querySelector("#auth-title");
  if (title) title.textContent = mode === "login" ? "Que bom ter você de volta." : "Crie sua conta.";
  clearNotice(document.querySelector("#auth-feedback"));
}

async function submitLogin(form, button) {
  const fields = new FormData(form);
  const email = String(fields.get("email") || "").trim().toLowerCase();
  const password = String(fields.get("password") || "");
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  window.location.replace(await routeForUser(data.user));
}

async function submitSignup(form, button) {
  const fields = new FormData(form);
  const fullName = String(fields.get("fullName") || "").trim();
  const phone = String(fields.get("phone") || "").trim();
  const email = String(fields.get("email") || "").trim().toLowerCase();
  const password = String(fields.get("password") || "");
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName, phone } }
  });
  if (error) throw error;
  const feedback = document.querySelector("#auth-feedback");
  if (data.session) {
    window.location.replace("cliente.html");
    return;
  }
  form.reset();
  setAuthMode("login");
  setNotice(feedback, "Conta criada. Verifique seu e-mail para confirmar o cadastro e depois entre na sua conta.");
}

async function initLogin() {
  if (!supabase) {
    configurationNotice();
    return;
  }
  const signupRequested = new URLSearchParams(window.location.search).get("cadastro") === "1";
  setAuthMode(signupRequested ? "signup" : "login");
  document.querySelectorAll("[data-auth-mode]").forEach((tab) => {
    tab.addEventListener("click", () => setAuthMode(tab.dataset.authMode));
  });
  document.querySelectorAll("[data-auth-form]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const button = form.querySelector('button[type="submit"]');
      clearNotice(document.querySelector("#auth-feedback"));
      withButtonLock(button, () => form.dataset.authForm === "login"
        ? submitLogin(form, button)
        : submitSignup(form, button));
    });
  });
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (session?.user) window.location.replace(routeForUser(session.user));
}

let customerCategory = "a-la-minuta";
let productPage = 0;
let orderPage = 0;
let productsCount = 0;
let promotions = [];
let promotionIndex = 0;
let promotionTimer = null;
let orderChannel = null;

function isWithinTimeRange(now, start, end) {
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  const from = startHour * 60 + startMinute;
  const to = endHour * 60 + endMinute;
  const current = now.getHours() * 60 + now.getMinutes();
  return from < to ? current >= from && current < to : current >= from || current < to;
}

function shopHoursSummary(settings) {
  const lunchMode = settings.lunch_open ? "aberto" : "fechado";
  const evening = settings.evening_enabled
    ? `${settings.evening_start.slice(0, 5)}–${settings.evening_end.slice(0, 5)}`
    : "fechado";
  return `Expediente ${settings.opening_time.slice(0, 5)}–${settings.closing_time.slice(0, 5)} · Almoço ${lunchMode} ${settings.lunch_start.slice(0, 5)}–${settings.lunch_end.slice(0, 5)} · Noite ${evening}`;
}

function currentShopStatus(settings, now = new Date()) {
  const insideDay = isWithinTimeRange(now, settings.opening_time, settings.closing_time);
  const insideLunch = insideDay && !settings.lunch_open &&
    isWithinTimeRange(now, settings.lunch_start, settings.lunch_end);
  const insideEvening = settings.evening_enabled &&
    isWithinTimeRange(now, settings.evening_start, settings.evening_end);
  const open = settings.manual_open && ((insideDay && !insideLunch) || insideEvening);
  const reason = !settings.manual_open
    ? "Fechado temporariamente pela loja"
    : insideLunch
      ? "Pausa no horário de almoço"
      : open
        ? "Recebendo pedidos agora"
        : "Fora do horário de atendimento";
  return { open, reason, hours: shopHoursSummary(settings) };
}

function renderEmpty(container, message) {
  container.replaceChildren();
  const empty = document.createElement("div");
  empty.className = "empty-state";
  empty.textContent = message;
  container.append(empty);
}

function renderPager(container, page, total, pageSize, onChange) {
  container.replaceChildren();
  const pages = Math.ceil(total / pageSize);
  if (pages <= 1) return;
  const previous = document.createElement("button");
  previous.type = "button";
  previous.textContent = "← Anterior";
  previous.disabled = page === 0;
  previous.addEventListener("click", () => onChange(page - 1));
  const status = document.createElement("span");
  status.textContent = `Página ${page + 1} de ${pages}`;
  const next = document.createElement("button");
  next.type = "button";
  next.textContent = "Próxima →";
  next.disabled = page >= pages - 1;
  next.addEventListener("click", () => onChange(page + 1));
  container.append(previous, status, next);
}

function makeProductCard(product) {
  const card = document.createElement("article");
  const unavailable = !product.is_active || product.stock === 0;
  card.className = `product-card${unavailable ? " is-unavailable" : ""}`;
  const image = imageElement(product.image_url, product.name, "product-image");
  card.append(image);
  if (unavailable) {
    const notice = document.createElement("span");
    notice.className = "product-unavailable-label";
    notice.textContent = "Em falta";
    card.append(notice);
  }
  const body = document.createElement("div");
  body.className = "product-card-body";
  const title = document.createElement("h3");
  title.textContent = product.name;
  const description = document.createElement("p");
  description.textContent = product.description || "Preparado com carinho pela nossa cozinha.";
  const footer = document.createElement("div");
  footer.className = "product-card-footer";
  const price = document.createElement("strong");
  price.textContent = money(product.promotional_price || product.price);
  footer.append(price);
  if (product.promotional_price) {
    const regularPrice = document.createElement("del");
    regularPrice.textContent = money(product.price);
    footer.append(regularPrice);
  }
  const add = document.createElement("button");
  add.type = "button";
  add.className = "add-to-cart";
  add.textContent = "+";
  add.setAttribute("aria-label", `Adicionar ${product.name} ao pedido`);
  add.disabled = unavailable;
  if (unavailable) add.textContent = "Em falta";
  add.addEventListener("click", () => addToCart(product));
  footer.append(add);
  body.append(title, description, footer);
  card.append(body);
  return card;
}

function renderCustomerStoreStatus(settings) {
  const container = document.querySelector("[data-customer-store-status]");
  const title = document.querySelector("[data-store-status-title]");
  const hours = document.querySelector("[data-store-status-hours]");
  const indicator = document.querySelector("[data-store-status-indicator]");
  if (!container || !title || !hours || !indicator) return;
  const status = currentShopStatus(settings);
  title.textContent = `${status.open ? "Aberto agora" : "Fechado agora"} · ${status.reason}`;
  hours.textContent = status.hours;
  indicator.classList.toggle("is-open", status.open);
  container.hidden = false;
}

async function loadCustomerStoreSettings() {
  const container = document.querySelector("[data-customer-store-status]");
  if (!container) return;
  const { data, error } = await supabase.from("store_settings")
    .select("opening_time,closing_time,lunch_open,lunch_start,lunch_end,evening_enabled,evening_start,evening_end,manual_open")
    .eq("id", true).single();
  if (error) {
    const title = document.querySelector("[data-store-status-title]");
    const hours = document.querySelector("[data-store-status-hours]");
    if (title) title.textContent = "Status da loja indisponível";
    if (hours) hours.textContent = "Não foi possível carregar os horários. Tente novamente mais tarde.";
    container.hidden = false;
    throw error;
  }
  shopSettings = data;
  renderCustomerStoreStatus(shopSettings);
  window.setInterval(() => renderCustomerStoreStatus(shopSettings), 60_000);
  supabase.channel("customer-store-settings")
    .on("postgres_changes", { event: "*", schema: "public", table: "store_settings" }, (payload) => {
      if (payload.new) {
        shopSettings = payload.new;
        renderCustomerStoreStatus(shopSettings);
      }
    })
    .subscribe((status, subscribeError) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.error("A atualização em tempo real do expediente falhou.", subscribeError);
        showToast("Não foi possível acompanhar atualizações do horário da loja.");
      }
    });
}

async function loadCustomerCategories() {
  const container = document.querySelector("[data-customer-categories]");
  const { data, error } = await supabase.from("menu_categories")
    .select("key,name").eq("is_active", true).order("sort_order");
  if (error) throw error;
  if (!data?.length) throw new Error("Cadastre ao menos uma categoria ativa no gestor do cardápio.");
  if (!data.some((category) => category.key === customerCategory)) customerCategory = data[0].key;
  container.replaceChildren(...data.map((category) => {
    const tab = document.createElement("button");
    tab.className = `category-tab${category.key === customerCategory ? " is-active" : ""}`;
    tab.type = "button";
    tab.role = "tab";
    tab.setAttribute("aria-selected", String(category.key === customerCategory));
    tab.dataset.category = category.key;
    tab.textContent = category.name;
    return tab;
  }));
}

async function loadProducts() {
  const container = document.querySelector("[data-products]");
  const pager = document.querySelector("[data-product-pagination]");
  container.setAttribute("aria-busy", "true");
  const start = productPage * PAGE_SIZE;
  const { data, count, error } = await supabase.from("products")
    .select("id,name,description,price,promotional_price,stock,image_url,category,is_active,sort_order", { count: "exact" })
    .eq("category", customerCategory)
    .order("sort_order").order("name").range(start, start + PAGE_SIZE - 1);
  container.removeAttribute("aria-busy");
  if (error) throw error;
  productsCount = count || 0;
  if (!data?.length) renderEmpty(container, "Ainda não há produtos disponíveis nesta categoria.");
  else container.replaceChildren(...data.map(makeProductCard));
  renderPager(pager, productPage, productsCount, PAGE_SIZE, (next) => {
    productPage = next;
    loadProducts().catch(handleFailure);
  });
}

function updatePromotionBackground(promotion) {
  const backdrop = document.querySelector("[data-promotion-backdrop]");
  const image = promotion
    ? safeImagePath(promotion.image_url || promotion.product?.image_url)
    : "assets/background.png";
  backdrop.style.setProperty("--promotion-image", `url("${image.replaceAll('"', "%22")}")`);
}

function renderPromotion() {
  const content = document.querySelector("[data-promotion-content]");
  const title = document.querySelector("[data-promotion-title]");
  const description = document.querySelector("[data-promotion-description]");
  const price = document.querySelector("[data-promotion-price]");
  const photo = document.querySelector("[data-promotion-image]");
  const add = document.querySelector("[data-promotion-add]");
  const dots = document.querySelector("[data-promotion-dots]");
  if (!promotions.length) {
    title.textContent = "Novidades da nossa cozinha";
    description.textContent = "As próximas ofertas especiais aparecem aqui.";
    price.textContent = "";
    photo.src = "assets/Bife De Gado Acebolado.png";
    photo.alt = "Prato preparado pela Ferrari Delivery";
    add.disabled = true;
    dots.replaceChildren();
    updatePromotionBackground(null);
    return;
  }
  const promotion = promotions[promotionIndex];
  title.textContent = promotion.product.name;
  description.textContent = promotion.description || promotion.product.description || "Uma oferta especial preparada para você.";
  price.textContent = money(promotion.price);
  photo.src = safeImagePath(promotion.image_url || promotion.product.image_url);
  photo.alt = promotion.product.name;
  add.disabled = false;
  updatePromotionBackground(promotion);
  dots.replaceChildren(...promotions.map((item, index) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = `promotion-dot${index === promotionIndex ? " is-active" : ""}`;
    dot.setAttribute("aria-label", `Exibir promoção ${index + 1}`);
    dot.addEventListener("click", () => changePromotion(index));
    return dot;
  }));
}

function changePromotion(nextIndex) {
  if (!promotions.length || nextIndex === promotionIndex) return;
  const content = document.querySelector("[data-promotion-content]");
  content.classList.add("is-leaving");
  window.setTimeout(() => {
    promotionIndex = (nextIndex + promotions.length) % promotions.length;
    renderPromotion();
    content.classList.remove("is-leaving");
  }, 300);
}

async function loadPromotions() {
  const { data, error } = await supabase.from("promotions")
    .select("id,product_id,price,image_url,description,ends_at,product:products(id,name,description,price,promotional_price,image_url,category,is_active)")
    .eq("is_active", true).order("created_at", { ascending: false }).limit(20);
  if (error) throw error;
  const now = Date.now();
  promotions = (data || []).filter((item) =>
    item.product?.is_active && Number(item.price) <= Number(item.product.promotional_price || item.product.price) &&
    (!item.ends_at || new Date(item.ends_at).getTime() > now)
  );
  promotionIndex = 0;
  renderPromotion();
  if (promotionTimer) window.clearInterval(promotionTimer);
  if (promotions.length > 1) promotionTimer = window.setInterval(() => changePromotion(promotionIndex + 1), 6500);
}

function addToCart(product, promotion = null) {
  if (!product.is_active || product.stock === 0) {
    showToast(`${product.name} está em falta no momento.`);
    return;
  }
  const promotionId = promotion?.id || null;
  const existing = cart.find((item) => item.product_id === product.id && item.promotion_id === promotionId);
  if (existing) {
    if (existing.quantity >= 50) {
      showToast("Você atingiu o limite por produto.");
      return;
    }
    existing.quantity += 1;
  } else {
    cart.push({
      product_id: product.id,
      promotion_id: promotionId,
      name: product.name,
      price: Number(promotion?.price ?? product.promotional_price ?? product.price),
      quantity: 1
    });
  }
  saveCart();
  showToast(`${product.name} adicionado ao carrinho.`);
}

function cartTotal() {
  return cart.reduce((total, item) => total + item.price * item.quantity, 0);
}

function renderCart() {
  const count = cart.reduce((total, item) => total + item.quantity, 0);
  const countElement = document.querySelector("[data-cart-count]");
  const totalElement = document.querySelector("[data-cart-total]");
  const checkout = document.querySelector("[data-checkout]");
  if (countElement) countElement.textContent = String(count);
  if (totalElement) totalElement.textContent = money(cartTotal());
  if (checkout) checkout.disabled = count === 0;
  renderInlineCart();
}

function changeCartQuantity(index, change) {
  const item = cart[index];
  if (!item) return;
  const nextQuantity = item.quantity + change;
  if (nextQuantity <= 0) cart.splice(index, 1);
  else item.quantity = Math.min(nextQuantity, 50);
  saveCart();
  if (document.querySelector("[data-cart-dialog]")?.open) renderCartDialog();
}

function makeCartRow(item, index, inline = false) {
  const row = document.createElement(inline ? "article" : "div");
  row.className = inline ? "inline-cart-row" : "cart-dialog-row";
  const name = document.createElement("strong");
  name.textContent = item.name;
  const subtotal = document.createElement("strong");
  subtotal.className = inline ? "inline-cart-subtotal" : "";
  subtotal.textContent = money(item.price * item.quantity);
  const detail = document.createElement(inline ? "small" : "p");
  detail.textContent = `${money(item.price)} cada`;
  const controls = document.createElement("div");
  controls.className = inline ? "inline-cart-controls" : "quantity-controls";
  const decrease = document.createElement("button");
  decrease.type = "button";
  decrease.textContent = "−";
  decrease.setAttribute("aria-label", `Remover uma unidade de ${item.name}`);
  decrease.addEventListener("click", () => changeCartQuantity(index, -1));
  const quantity = document.createElement("span");
  quantity.textContent = String(item.quantity);
  const increase = document.createElement("button");
  increase.type = "button";
  increase.textContent = "+";
  increase.setAttribute("aria-label", `Adicionar uma unidade de ${item.name}`);
  increase.disabled = item.quantity >= 50;
  increase.addEventListener("click", () => changeCartQuantity(index, 1));
  controls.append(decrease, quantity, increase);
  if (inline) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-cart-item";
    remove.textContent = "Remover";
    remove.setAttribute("aria-label", `Remover ${item.name} do carrinho`);
    remove.addEventListener("click", () => {
      cart.splice(index, 1);
      saveCart();
      if (document.querySelector("[data-cart-dialog]")?.open) renderCartDialog();
    });
    controls.append(remove);
    const product = document.createElement("div");
    product.className = "inline-cart-product";
    product.append(name, detail);
    row.append(product, subtotal, controls);
  } else {
    row.append(name, subtotal, detail, controls);
  }
  return row;
}

function renderInlineCart() {
  const container = document.querySelector("[data-inline-cart]");
  const total = document.querySelector("[data-inline-cart-total]");
  if (!container || !total) return;
  total.textContent = money(cartTotal());
  if (!cart.length) {
    renderEmpty(container, "Seu carrinho está vazio. Adicione produtos do cardápio para começar.");
    return;
  }
  container.replaceChildren(...cart.map((item, index) => makeCartRow(item, index, true)));
}

function renderCartDialog() {
  const container = document.querySelector("[data-cart-items]");
  const total = document.querySelector("[data-dialog-total]");
  container.replaceChildren();
  if (!cart.length) {
    renderEmpty(container, "Seu carrinho está vazio. Volte ao cardápio para adicionar produtos.");
  } else {
    cart.forEach((item, index) => container.append(makeCartRow(item, index)));
  }
  total.textContent = money(cartTotal());
}

function populateAddressForm() {
  const form = document.querySelector("[data-address-form]");
  form.elements.fullName.value = profile?.full_name || activeUser?.user_metadata?.full_name || "";
  form.elements.phone.value = profile?.phone || activeUser?.user_metadata?.phone || "";
  form.elements.street.value = profile?.street || "";
  form.elements.number.value = profile?.street_number || "";
  form.elements.complement.value = profile?.complement || "";
  form.elements.neighborhood.value = profile?.neighborhood || "";
  form.elements.city.value = profile?.city || "";
  form.elements.whatsapp_opt_in.checked = profile?.whatsapp_opt_in === true;
  form.elements.avatarFile.value = "";
  selectedAvatarFile = null;
  clearAvatarPreviewUrl();
  document.querySelector("[data-avatar-preview]").src =
    document.querySelector("[data-profile-avatar]")?.src || "assets/logo.png";
  avatarPositionX = 50;
  avatarPositionY = 50;
  avatarZoom = 1;
  setAvatarPosition();
}

function profileNeedsAddress(value) {
  return !value?.full_name?.trim() || !value?.phone?.trim() ||
    !value?.street?.trim() || !value?.street_number?.trim() ||
    !value?.neighborhood?.trim() || !value?.city?.trim();
}

async function fetchProfile() {
  const { data, error } = await supabase.from("profiles")
    .select("user_id,full_name,phone,street,street_number,complement,neighborhood,city,whatsapp_opt_in,avatar_path")
    .eq("user_id", activeUser.id).maybeSingle();
  if (error) throw error;
  profile = data;
  const accountName = document.querySelector("[data-account-name]");
  if (accountName) accountName.textContent = data?.full_name || activeUser.email;
  const avatar = document.querySelector("[data-profile-avatar]");
  if (avatar) {
    avatar.src = "assets/logo.png";
    if (data?.avatar_path) {
      const { data: signedImage, error: signedImageError } = await supabase.storage
        .from(AVATAR_BUCKET).createSignedUrl(data.avatar_path, 3600);
      if (signedImageError) throw signedImageError;
      avatar.src = signedImage.signedUrl;
    }
  }
}

function setAvatarPosition() {
  const preview = document.querySelector("[data-avatar-preview]");
  if (!preview) return;
  preview.style.objectPosition = `${avatarPositionX}% ${avatarPositionY}%`;
  preview.style.transform = `scale(${avatarZoom})`;
  document.querySelector("[data-avatar-x]").value = String(avatarPositionX);
  document.querySelector("[data-avatar-y]").value = String(avatarPositionY);
  document.querySelector("[data-avatar-zoom]").value = String(avatarZoom);
}

function clearAvatarPreviewUrl() {
  if (!avatarPreviewUrl) return;
  URL.revokeObjectURL(avatarPreviewUrl);
  avatarPreviewUrl = null;
}

function cropAvatar(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const sourceUrl = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(sourceUrl);
      const size = 512;
      const scale = Math.max(size / image.naturalWidth, size / image.naturalHeight) * avatarZoom;
      const sourceWidth = size / scale;
      const sourceHeight = size / scale;
      const sourceX = (image.naturalWidth - sourceWidth) * avatarPositionX / 100;
      const sourceY = (image.naturalHeight - sourceHeight) * avatarPositionY / 100;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("Não foi possível preparar a foto."));
        return;
      }
      context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, size, size);
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("Não foi possível preparar a foto."));
          return;
        }
        resolve(blob);
      }, "image/jpeg", 0.88);
    };
    image.onerror = () => {
      URL.revokeObjectURL(sourceUrl);
      reject(new Error("Não foi possível abrir esta imagem."));
    };
    image.src = sourceUrl;
  });
}

async function selectAvatar(file) {
  if (!file) return;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("Escolha uma imagem JPG, PNG ou WebP.");
  }
  if (file.size > MAX_AVATAR_SIZE) {
    throw new Error("A foto precisa ter no máximo 5 MB.");
  }
  const previewUrl = URL.createObjectURL(file);
  const image = new Image();
  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("Não foi possível abrir esta imagem."));
      image.src = previewUrl;
    });
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("A imagem selecionada não é válida.");
    clearAvatarPreviewUrl();
    avatarPreviewUrl = previewUrl;
    selectedAvatarFile = file;
    document.querySelector("[data-avatar-preview]").src = avatarPreviewUrl;
    avatarPositionX = 50;
    avatarPositionY = 50;
    avatarZoom = 1;
    setAvatarPosition();
  } catch (error) {
    URL.revokeObjectURL(previewUrl);
    throw error;
  }
}

function openAddressDialog(forOrder = true) {
  addressSubmissionCreatesOrder = forOrder;
  populateAddressForm();
  document.querySelector("[data-address-feedback]").hidden = true;
  document.querySelector("#address-title").textContent = forOrder ? "Complete seu endereço" : "Dados de entrega e avisos";
  document.querySelector("[data-address-submit]").textContent = forOrder ? "Salvar e enviar pedido" : "Salvar dados";
  document.querySelector("[data-address-dialog]").showModal();
}

async function placeOrder() {
  if (!cart.length) return;
  const orderItems = cart.map((item) => ({
    product_id: item.product_id,
    quantity: item.quantity,
    promotion_id: item.promotion_id
  }));
  const { data, error } = await supabase.rpc("place_order", { p_items: orderItems });
  if (error) throw error;
  cart.splice(0, cart.length);
  saveCart();
  document.querySelector("[data-address-dialog]").close();
  document.querySelector("[data-cart-dialog]").close();
  showToast(`Pedido ${String(data).slice(0, 8)} enviado. Obrigado!`);
  await loadCustomerOrders();
}

async function submitAddress(form, button) {
  const values = new FormData(form);
  const submittedProfile = {
    user_id: activeUser.id,
    full_name: String(values.get("fullName") || "").trim(),
    phone: String(values.get("phone") || "").trim(),
    street: String(values.get("street") || "").trim(),
    street_number: String(values.get("number") || "").trim(),
    complement: String(values.get("complement") || "").trim(),
    neighborhood: String(values.get("neighborhood") || "").trim(),
    city: String(values.get("city") || "").trim(),
    whatsapp_opt_in: form.elements.whatsapp_opt_in.checked,
    avatar_path: profile?.avatar_path || null
  };
  const feedback = document.querySelector("[data-address-feedback]");
  if (submittedProfile.full_name.length < 3 || !submittedProfile.phone || !submittedProfile.street ||
    !submittedProfile.street_number || !submittedProfile.neighborhood || !submittedProfile.city) {
    setNotice(feedback, "Preencha nome, telefone, rua, número, bairro e cidade para continuar.", true);
    return;
  }
  if (selectedAvatarFile) {
    const avatarPath = `${activeUser.id}/avatar.jpg`;
    const { error: uploadError } = await supabase.storage.from(AVATAR_BUCKET).upload(
      avatarPath,
      await cropAvatar(selectedAvatarFile),
      { upsert: true, contentType: "image/jpeg", cacheControl: "3600" }
    );
    if (uploadError) throw uploadError;
    submittedProfile.avatar_path = avatarPath;
  }
  const { error } = await supabase.from("profiles").upsert(submittedProfile, { onConflict: "user_id" });
  if (error) throw error;
  profile = submittedProfile;
  selectedAvatarFile = null;
  clearAvatarPreviewUrl();
  await fetchProfile();
  if (!addressSubmissionCreatesOrder) {
    document.querySelector("[data-address-dialog]").close();
    showToast("Dados de entrega atualizados.");
    return;
  }
  await placeOrder();
}

function statusLabel(status) {
  const labels = {
    recebido: "Recebido",
    em_andamento: "Em andamento",
    saiu_para_entrega: "Saiu para entrega",
    pronto: "Pronto",
    cancelado: "Cancelado"
  };
  return labels[status] || "Em andamento";
}

function makeCustomerOrder(order) {
  const card = document.createElement("article");
  card.className = "order-card";
  const details = document.createElement("div");
  const heading = document.createElement("h3");
  heading.textContent = `Pedido #${order.id.slice(0, 8).toUpperCase()}`;
  const date = document.createElement("p");
  date.textContent = new Date(order.created_at).toLocaleString("pt-BR");
  const items = document.createElement("p");
  items.textContent = (order.order_items || []).map((item) => `${item.quantity}× ${item.product_name}`).join(", ");
  details.append(heading, date, items);
  const side = document.createElement("div");
  side.className = "order-card-side";
  const badge = document.createElement("span");
  badge.className = "status-badge";
  badge.dataset.status = order.status;
  badge.textContent = statusLabel(order.status);
  const total = document.createElement("strong");
  total.textContent = money(order.total);
  side.append(badge, total);
  card.append(details, side);
  return card;
}

async function loadCustomerOrders() {
  const container = document.querySelector("[data-customer-orders]");
  const pager = document.querySelector("[data-order-pagination]");
  const start = orderPage * HISTORY_PAGE_SIZE;
  const { data, count, error } = await supabase.from("orders")
    .select("id,status,total,created_at,order_items(product_name,quantity)", { count: "exact" })
    .eq("user_id", activeUser.id).order("created_at", { ascending: false })
    .range(start, start + HISTORY_PAGE_SIZE - 1);
  if (error) throw error;
  if (!data?.length) renderEmpty(container, "Seus pedidos realizados aparecerão aqui.");
  else container.replaceChildren(...data.map(makeCustomerOrder));
  renderPager(pager, orderPage, count || 0, HISTORY_PAGE_SIZE, (next) => {
    orderPage = next;
    loadCustomerOrders().catch(handleFailure);
  });
}

function bindCustomerEvents() {
  document.querySelectorAll("[data-sign-out]").forEach((button) => {
    button.addEventListener("click", () => withButtonLock(button, signOut));
  });
  document.querySelector("[data-edit-profile]").addEventListener("click", (event) => withButtonLock(event.currentTarget, async () => {
    await fetchProfile();
    openAddressDialog(false);
  }));
  document.querySelector("[data-theme-toggle]").addEventListener("click", () => {
    const nextTheme = themePreference === "light" ? "dark" : "light";
    applyTheme(nextTheme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch (error) {
      console.error("Não foi possível salvar a preferência de tema.", error);
      showToast("O tema foi alterado, mas não será mantido após fechar o navegador.");
    }
  });
  document.querySelector("[data-customer-categories]").addEventListener("click", (event) => {
    const tab = event.target.closest("[data-category]");
    if (tab) {
      customerCategory = tab.dataset.category;
      productPage = 0;
      document.querySelectorAll("[data-category]").forEach((item) => {
        const selected = item === tab;
        item.classList.toggle("is-active", selected);
        item.setAttribute("aria-selected", String(selected));
      });
      loadProducts().catch(handleFailure);
    }
  });
  document.querySelector("[data-promotion-prev]").addEventListener("click", () => changePromotion(promotionIndex - 1));
  document.querySelector("[data-promotion-next]").addEventListener("click", () => changePromotion(promotionIndex + 1));
  document.querySelector("[data-promotion-add]").addEventListener("click", () => {
    const promotion = promotions[promotionIndex];
    if (promotion) addToCart(promotion.product, promotion);
  });
  document.querySelector("[data-checkout]").addEventListener("click", () => {
    renderCartDialog();
    document.querySelector("[data-cart-dialog]").showModal();
  });
  document.querySelector("[data-close-cart]").addEventListener("click", () => document.querySelector("[data-cart-dialog]").close());
  document.querySelector("[data-close-address]").addEventListener("click", () => document.querySelector("[data-address-dialog]").close());
  document.querySelector("[data-open-address]").addEventListener("click", (event) => withButtonLock(event.currentTarget, async () => {
    await fetchProfile();
    if (profileNeedsAddress(profile)) {
      openAddressDialog();
      return;
    }
    await placeOrder();
  }));
  document.querySelector("[data-address-form]").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    clearNotice(document.querySelector("[data-address-feedback]"));
    withButtonLock(button, () => submitAddress(form, button));
  });
  const avatarFileInput = document.querySelector("#avatar-file");
  avatarFileInput.addEventListener("change", () => {
    const [file] = avatarFileInput.files || [];
    selectAvatar(file).catch((error) => {
      showToast(error.message || "Não foi possível carregar esta foto.");
      avatarFileInput.value = "";
    });
  });
  document.querySelector("[data-avatar-zoom]").addEventListener("input", (event) => {
    avatarZoom = Number(event.currentTarget.value);
    setAvatarPosition();
  });
  document.querySelector("[data-avatar-x]").addEventListener("input", (event) => {
    avatarPositionX = Number(event.currentTarget.value);
    setAvatarPosition();
  });
  document.querySelector("[data-avatar-y]").addEventListener("input", (event) => {
    avatarPositionY = Number(event.currentTarget.value);
    setAvatarPosition();
  });
  const cropArea = document.querySelector("[data-avatar-crop]");
  let dragPosition = null;
  cropArea.addEventListener("pointerdown", (event) => {
    if (!selectedAvatarFile) return;
    dragPosition = { x: event.clientX, y: event.clientY };
    cropArea.setPointerCapture(event.pointerId);
  });
  cropArea.addEventListener("pointermove", (event) => {
    if (!dragPosition) return;
    const bounds = cropArea.getBoundingClientRect();
    avatarPositionX = Math.max(0, Math.min(100, avatarPositionX - (event.clientX - dragPosition.x) * 100 / bounds.width));
    avatarPositionY = Math.max(0, Math.min(100, avatarPositionY - (event.clientY - dragPosition.y) * 100 / bounds.height));
    dragPosition = { x: event.clientX, y: event.clientY };
    setAvatarPosition();
  });
  cropArea.addEventListener("pointerup", () => { dragPosition = null; });
  cropArea.addEventListener("pointercancel", () => { dragPosition = null; });
  document.querySelector("[data-address-dialog]").addEventListener("close", () => {
    if (!selectedAvatarFile) return;
    selectedAvatarFile = null;
    clearAvatarPreviewUrl();
    document.querySelector("[data-avatar-preview]").src =
      document.querySelector("[data-profile-avatar]")?.src || "assets/logo.png";
  });
}

async function initCustomer() {
  const user = await requireCustomer();
  if (!user) return;
  bindCustomerEvents();
  renderCart();
  await loadCustomerCategories();
  const results = await Promise.allSettled([fetchProfile(), loadProducts(), loadPromotions(), loadCustomerOrders(), loadCustomerStoreSettings()]);
  results.filter((result) => result.status === "rejected").forEach((result) => handleFailure(result.reason));
}

let audioContext = null;

function alertNewOrder() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("Web Audio não disponível neste navegador.");
    audioContext ||= new AudioContextClass();
    if (audioContext.state === "suspended") audioContext.resume();
    [880, 660, 880].forEach((frequency, index) => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(.0001, audioContext.currentTime + index * .2);
      gain.gain.exponentialRampToValueAtTime(.18, audioContext.currentTime + index * .2 + .02);
      gain.gain.exponentialRampToValueAtTime(.0001, audioContext.currentTime + index * .2 + .14);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(audioContext.currentTime + index * .2);
      oscillator.stop(audioContext.currentTime + index * .2 + .15);
    });
  } catch (error) {
    console.error("Não foi possível tocar o alerta sonoro.", error);
    showToast("Novo pedido recebido. Toque para habilitar o alerta sonoro do navegador.");
  }
}

function makePrintSheet(order) {
  const sheet = document.querySelector("[data-print-sheet]");
  sheet.replaceChildren();
  const title = document.createElement("h1");
  title.textContent = "FERRARI DELIVERY";
  const subtitle = document.createElement("p");
  subtitle.textContent = "COMANDA DO PEDIDO";
  const ruleOne = document.createElement("hr");
  const id = document.createElement("p");
  id.textContent = `Pedido: #${order.id.toUpperCase()}`;
  const time = document.createElement("p");
  time.textContent = new Date(order.created_at).toLocaleString("pt-BR");
  const customer = document.createElement("p");
  customer.textContent = `Cliente: ${order.profile?.full_name || "Não informado"}`;
  const phone = document.createElement("p");
  phone.textContent = `Telefone: ${order.profile?.phone || "Não informado"}`;
  const address = document.createElement("p");
  address.textContent = `Endereço: ${[order.profile?.street, order.profile?.street_number, order.profile?.complement, order.profile?.neighborhood, order.profile?.city].filter(Boolean).join(", ") || "Não informado"}`;
  const ruleTwo = document.createElement("hr");
  const items = document.createElement("div");
  (order.order_items || []).forEach((item) => {
    const line = document.createElement("p");
    line.textContent = `${item.quantity}x ${item.product_name} — ${money(item.line_total)}`;
    items.append(line);
  });
  const ruleThree = document.createElement("hr");
  const total = document.createElement("p");
  total.className = "print-total";
  total.textContent = `TOTAL: ${money(order.total)}`;
  const status = document.createElement("p");
  status.textContent = `Status: ${statusLabel(order.status)}`;
  sheet.append(title, subtitle, ruleOne, id, time, customer, phone, address, ruleTwo, items, ruleThree, total, status);
}

function printOrder(order) {
  makePrintSheet(order);
  window.print();
}

async function printIncomingOrder(orderId) {
  const { data: order, error } = await supabase.from("orders")
    .select("id,user_id,status,total,created_at,profile:profiles(full_name,phone,street,street_number,complement,neighborhood,city),order_items(product_name,quantity,unit_price,line_total)")
    .eq("id", orderId).single();
  if (error) throw error;
  printOrder(order);
}

function subscribeAdminOrders() {
  orderChannel = supabase.channel("admin-order-feed")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "orders" }, (payload) => {
      alertNewOrder();
      showToast("Novo pedido recebido.");
      if ("Notification" in window && Notification.permission === "granted") {
        try {
          new Notification("Novo pedido recebido", { body: "Um novo pedido chegou à loja." });
        } catch (error) {
          console.error("Não foi possível exibir a notificação do pedido.", error);
        }
      }
      document.querySelector("#admin-view")?.contentWindow?.postMessage({ type: "admin:orders-changed" }, window.location.origin);
      loadAdminCounts().catch(handleFailure);
      if (readAdminPreference("thermal-print", true)) printIncomingOrder(payload.new.id).catch(handleFailure);
    })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders" }, () => {
      document.querySelector("#admin-view")?.contentWindow?.postMessage({ type: "admin:orders-changed" }, window.location.origin);
      loadAdminCounts().catch(handleFailure);
    })
    .subscribe((status, error) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.error("A assinatura de pedidos em tempo real falhou.", error);
        showToast("Não foi possível conectar aos pedidos em tempo real. Atualize o painel.");
      }
    });
}

function readAdminPreference(key, fallback) {
  try {
    const stored = localStorage.getItem(`ferrari-admin-${key}`);
    return stored === null ? fallback : stored === "true";
  } catch (error) {
    console.error("Não foi possível ler uma preferência do painel.", error);
    return fallback;
  }
}

function saveAdminPreference(key, value) {
  try {
    localStorage.setItem(`ferrari-admin-${key}`, String(value));
  } catch (error) {
    console.error("Não foi possível salvar uma preferência do painel.", error);
    showToast("Não foi possível salvar esta preferência neste navegador.");
  }
}

function readAdminTheme() {
  try {
    return localStorage.getItem("ferrari-admin-theme") === "light" ? "light" : "dark";
  } catch (error) {
    console.error("Não foi possível ler o tema administrativo.", error);
    return "dark";
  }
}

function applyAdminTheme(theme) {
  const selectedTheme = theme === "light" ? "light" : "dark";
  document.body.dataset.adminTheme = selectedTheme;
  document.querySelector("#admin-view")?.contentWindow?.postMessage(
    { type: "admin:theme", theme: selectedTheme },
    window.location.origin
  );
}

function renderShopSettingsStatus() {
  if (!shopSettings) return;
  const form = document.querySelector("[data-settings-form]");
  const settings = form && document.querySelector("[data-settings-dialog]").open
    ? {
      ...shopSettings,
      opening_time: form.elements.opening_time.value || shopSettings.opening_time,
      closing_time: form.elements.closing_time.value || shopSettings.closing_time,
      lunch_open: form.elements.lunch_open.value === "true",
      lunch_start: form.elements.lunch_start.value || shopSettings.lunch_start,
      lunch_end: form.elements.lunch_end.value || shopSettings.lunch_end,
      evening_enabled: form.elements.evening_enabled.checked,
      evening_start: form.elements.evening_start.value || shopSettings.evening_start,
      evening_end: form.elements.evening_end.value || shopSettings.evening_end,
      manual_open: form.elements.manual_open.checked
    }
    : shopSettings;
  const status = currentShopStatus(settings);
  const preview = document.querySelector("[data-settings-status]");
  preview.textContent = `${status.open ? "Aberta agora" : "Fechada agora"} · ${status.reason}\n${status.hours}`;
  preview.classList.toggle("is-open", status.open);
}

function fillSettingsForm(settings) {
  const form = document.querySelector("[data-settings-form]");
  form.elements.opening_time.value = settings.opening_time.slice(0, 5);
  form.elements.closing_time.value = settings.closing_time.slice(0, 5);
  form.elements.lunch_open.value = String(settings.lunch_open);
  form.elements.lunch_start.value = settings.lunch_start.slice(0, 5);
  form.elements.lunch_end.value = settings.lunch_end.slice(0, 5);
  form.elements.evening_enabled.checked = settings.evening_enabled;
  form.elements.evening_start.value = settings.evening_start.slice(0, 5);
  form.elements.evening_end.value = settings.evening_end.slice(0, 5);
  form.elements.manual_open.checked = settings.manual_open;
  form.elements.theme.value = readAdminTheme();
  renderShopSettingsStatus();
}

async function loadShopSettings() {
  const { data, error } = await supabase.from("store_settings")
    .select("id,opening_time,closing_time,lunch_open,lunch_start,lunch_end,evening_enabled,evening_start,evening_end,manual_open")
    .eq("id", true).single();
  if (error) throw error;
  shopSettings = data;
  fillSettingsForm(shopSettings);
}

async function saveShopSettings(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('button[type="submit"]');
  const feedback = document.querySelector("[data-settings-feedback]");
  submit.disabled = true;
  clearNotice(feedback);
  try {
    const values = new FormData(form);
    const settings = {
      opening_time: String(values.get("opening_time")),
      closing_time: String(values.get("closing_time")),
      lunch_open: values.get("lunch_open") === "true",
      lunch_start: String(values.get("lunch_start")),
      lunch_end: String(values.get("lunch_end")),
      evening_enabled: form.elements.evening_enabled.checked,
      evening_start: String(values.get("evening_start")),
      evening_end: String(values.get("evening_end")),
      manual_open: form.elements.manual_open.checked,
      updated_at: new Date().toISOString()
    };
    if (settings.opening_time === settings.closing_time ||
      settings.lunch_start === settings.lunch_end ||
      settings.evening_start === settings.evening_end) {
      throw new Error("Os horários de início e fim de cada período precisam ser diferentes.");
    }
    const { data, error } = await supabase.from("store_settings").update(settings)
      .eq("id", true)
      .select("id,opening_time,closing_time,lunch_open,lunch_start,lunch_end,evening_enabled,evening_start,evening_end,manual_open")
      .single();
    if (error) throw error;
    shopSettings = data;
    try {
      localStorage.setItem("ferrari-admin-theme", String(values.get("theme")));
    } catch (error) {
      console.error("Não foi possível salvar o tema administrativo.", error);
      setNotice(feedback, "Horários salvos, mas não foi possível salvar o tema neste navegador.", true);
      fillSettingsForm(shopSettings);
      return;
    }
    applyAdminTheme(String(values.get("theme")));
    fillSettingsForm(shopSettings);
    setNotice(feedback, "Configurações da loja salvas.");
  } catch (error) {
    console.error("Não foi possível salvar as configurações da loja.", error);
    setNotice(feedback, friendlyError(error), true);
  } finally {
    submit.disabled = false;
  }
}

async function loadAdminCounts() {
  const [{ count: ordersCount, error: ordersError }, { count: scheduledCount, error: scheduledError }] = await Promise.all([
    supabase.from("orders").select("id", { count: "exact", head: true }).not("status", "in", "(pronto,cancelado)").is("scheduled_for", null),
    supabase.from("orders").select("id", { count: "exact", head: true }).not("scheduled_for", "is", null).gt("scheduled_for", new Date().toISOString())
  ]);
  if (ordersError) throw ordersError;
  if (scheduledError) throw scheduledError;
  [
    [document.querySelector("[data-orders-count]"), ordersCount],
    [document.querySelector("[data-scheduled-count]"), scheduledCount]
  ].forEach(([badge, count]) => {
    const total = count || 0;
    badge.textContent = String(total);
    badge.dataset.hasOrders = String(total > 0);
    badge.setAttribute("aria-label", `${total} ${total === 1 ? "pedido" : "pedidos"}`);
  });
}

function bindAdminShellEvents() {
  bindSignOut();
  const sidebar = document.querySelector(".admin-sidebar");
  const sidebarToggle = document.querySelector("[data-sidebar-toggle]");
  let sidebarPinned = false;
  const updateSidebar = (expanded) => {
    sidebar.classList.toggle("is-expanded", expanded);
    sidebarToggle.setAttribute("aria-expanded", String(expanded));
    sidebarToggle.setAttribute("aria-pressed", String(sidebarPinned));
    const label = sidebarPinned ? "Recolher menu lateral" : "Expandir menu lateral";
    sidebarToggle.setAttribute("aria-label", label);
    sidebarToggle.title = label;
  };
  sidebar.addEventListener("pointerenter", () => updateSidebar(true));
  sidebar.addEventListener("pointerleave", () => updateSidebar(sidebarPinned));
  sidebarToggle.addEventListener("click", () => {
    sidebarPinned = !sidebarPinned;
    updateSidebar(sidebarPinned || sidebar.matches(":hover"));
  });
  const printSwitch = document.querySelector("[data-print-switch]");
  const printLabel = document.querySelector("[data-print-label]");
  let thermalPrint = readAdminPreference("thermal-print", true);
  const updatePrintSwitch = () => {
    printSwitch.setAttribute("aria-pressed", String(thermalPrint));
    printLabel.textContent = thermalPrint ? "Impressão ativa" : "Impressão pausada";
  };
  updatePrintSwitch();
  printSwitch.addEventListener("click", () => {
    thermalPrint = !thermalPrint;
    saveAdminPreference("thermal-print", thermalPrint);
    updatePrintSwitch();
  });
  document.querySelector("[data-open-settings]").addEventListener("click", async () => {
    try {
      if (!shopSettings) await loadShopSettings();
      fillSettingsForm(shopSettings);
      clearNotice(document.querySelector("[data-settings-feedback]"));
      document.querySelector("[data-settings-dialog]").showModal();
    } catch (error) {
      console.error("Não foi possível abrir as configurações da loja.", error);
      showToast(friendlyError(error));
    }
  });
  const settingsDialog = document.querySelector("[data-settings-dialog]");
  document.querySelector("[data-close-settings]").addEventListener("click", () => settingsDialog.close());
  document.querySelector("[data-cancel-settings]").addEventListener("click", () => settingsDialog.close());
  document.querySelector("[data-settings-form]").addEventListener("submit", saveShopSettings);
  document.querySelector("[data-settings-form]").addEventListener("input", renderShopSettingsStatus);
  document.querySelector("[data-settings-form]").addEventListener("change", renderShopSettingsStatus);
  document.querySelector("[data-settings-form]").elements.theme.addEventListener("change", (event) => applyAdminTheme(event.currentTarget.value));
  settingsDialog.addEventListener("close", () => {
    document.querySelector("[data-settings-form]").elements.theme.value = readAdminTheme();
    applyAdminTheme(readAdminTheme());
  });
  document.querySelector("[data-whatsapp]").addEventListener("click", () =>
    showToast("O envio automático depende da Edge Function whatsapp-notifications configurada no Supabase."));
  const notificationButton = document.querySelector("[data-notifications]");
  const notificationStatus = document.querySelector("[data-notifications-status]");
  if ("Notification" in window && Notification.permission === "granted") {
    notificationButton.setAttribute("aria-pressed", "true");
    notificationStatus.textContent = "Ativadas";
  }
  notificationButton.addEventListener("click", async () => {
    if (!("Notification" in window)) {
      showToast("Este navegador não oferece suporte a notificações.");
      return;
    }
    try {
      const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
      const enabled = permission === "granted";
      notificationButton.setAttribute("aria-pressed", String(enabled));
      notificationStatus.textContent = enabled ? "Ativadas" : "Bloqueadas";
      if (!enabled) showToast("Permita notificações nas configurações do navegador.");
    } catch (error) {
      console.error("Não foi possível solicitar notificações.", error);
      showToast("Não foi possível ativar as notificações.");
    }
  });
  document.querySelectorAll("[data-admin-view]").forEach((button) => {
    button.addEventListener("click", () => {
      const selectedView = button.dataset.adminView;
      const frame = document.querySelector("#admin-view");
      frame.src = selectedView === "catalog" ? "gestor-cardapio.html" : `admin-view.html?view=${encodeURIComponent(selectedView)}`;
      document.querySelectorAll("[data-admin-view]").forEach((item) => item.classList.toggle("is-active", item === button));
    });
  });
  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin) return;
    if (event.data?.type === "admin:navigate-view" && typeof event.data.view === "string") {
      document.querySelector(`[data-admin-view="${event.data.view}"]`)?.click();
    }
    if (event.data?.type === "admin:print-order" && typeof event.data.orderId === "string") {
      printIncomingOrder(event.data.orderId).catch(handleFailure);
    }
    if (event.data?.type === "admin:theme" && (event.data.theme === "light" || event.data.theme === "dark")) {
      document.body.dataset.adminTheme = event.data.theme;
    }
  });
  document.querySelector("#admin-view").addEventListener("load", () => {
    const frame = document.querySelector("#admin-view");
    frame.contentWindow.postMessage({ type: "admin:theme", theme: readAdminTheme() }, window.location.origin);
  });
  document.querySelector("[data-menu-search]").addEventListener("input", (event) => {
    const query = event.currentTarget.value.trim().toLocaleLowerCase("pt-BR");
    document.querySelectorAll("[data-admin-view]").forEach((button) => {
      button.hidden = Boolean(query) && !button.textContent.toLocaleLowerCase("pt-BR").includes(query);
    });
    const group = document.querySelector(".admin-menu-group");
    if (query && [...group.querySelectorAll("[data-admin-view]")].some((button) => !button.hidden)) group.open = true;
  });
  loadAdminCounts().catch(handleFailure);
  document.body.addEventListener("pointerdown", () => {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      audioContext ||= new AudioContextClass();
      if (audioContext.state === "suspended") audioContext.resume().catch((error) => console.error("Não foi possível ativar o áudio.", error));
    } catch (error) {
      console.error("Não foi possível ativar o áudio.", error);
    }
  }, { once: true });
}

async function initAdmin() {
  const user = await requireAdmin();
  if (!user) return;
  applyAdminTheme(readAdminTheme());
  bindAdminShellEvents();
  try {
    await loadShopSettings();
  } catch (error) {
    console.error("Não foi possível carregar as configurações da loja.", error);
    setNotice(document.querySelector("[data-admin-feedback]"), friendlyError(error), true);
  }
  supabase.channel("admin-store-settings")
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "store_settings" }, (payload) => {
      if (!payload.new) return;
      shopSettings = payload.new;
      if (!document.querySelector("[data-settings-dialog]").open) fillSettingsForm(shopSettings);
    })
    .subscribe((status, error) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.error("A sincronização das configurações falhou.", error);
        showToast("Não foi possível sincronizar o status da loja.");
      }
    });
  subscribeAdminOrders();
}

function handleFailure(error) {
  console.error("Erro na aplicação.", error);
  showToast(friendlyError(error));
}

async function boot() {
  if (!supabase) {
    if (PAGE !== "home") configurationNotice();
    return;
  }
  if (PAGE === "home") await initHome();
  if (PAGE === "login") await initLogin();
  if (PAGE === "customer") {
    try { await initCustomer(); } catch (error) { handleFailure(error); }
  }
  if (PAGE === "admin") {
    try { await initAdmin(); } catch (error) { handleFailure(error); }
  }
}

boot().catch(handleFailure);
