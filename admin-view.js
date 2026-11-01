import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./supabase-config.js";

const MASTER_ADMIN_ID = "0680c531-6f8e-4ad8-aae9-4de4206765ab";
const supabase = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;
const view = new URLSearchParams(window.location.search).get("view") || "orders";
const title = document.querySelector("[data-view-title]");
const description = document.querySelector("[data-view-description]");
const content = document.querySelector("[data-view-content]");
const feedback = document.querySelector("[data-view-feedback]");

function applyAdminTheme(theme) {
  document.body.dataset.adminTheme = theme === "light" ? "light" : "dark";
}

function initializeAdminTheme() {
  try {
    applyAdminTheme(localStorage.getItem("ferrari-admin-theme"));
  } catch (error) {
    console.error("Não foi possível carregar o tema do painel.", error);
    applyAdminTheme("dark");
  }
  window.addEventListener("message", (event) => {
    if (event.origin === window.location.origin && event.data?.type === "admin:theme") {
      applyAdminTheme(event.data.theme);
    }
  });
}

const viewDetails = {
  orders: ["Pedidos Salão", "Acompanhe pedidos recebidos e atualize o andamento."],
  scheduled: ["Pedidos Agendados", "Pedidos com data e horário de entrega programados."],
  history: ["Histórico de Pedidos", "Consulte, compartilhe ou imprima os pedidos anteriores."],
  media: ["Imagens do cardápio", "Consulte imagens organizadas e ordene as categorias do catálogo."],
  bulk: ["Edição em massa", "Ajuste rapidamente preços, disponibilidade e estoque."],
  promotions: ["Promoções", "Gerencie os destaques exibidos no carrossel da loja."]
};

function showError(error) {
  console.error("Falha na área administrativa.", error);
  feedback.textContent = error?.message || "Não foi possível carregar esta área.";
  feedback.hidden = false;
  feedback.classList.add("is-error");
}

async function requireAdmin() {
  if (!supabase) throw new Error("Configure o Supabase para acessar o painel.");
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (!session) {
    window.top.location.href = "login.html";
    return false;
  }
  if (session.user.id === MASTER_ADMIN_ID || session.user.app_metadata?.role === "admin") return true;
  const { data, error } = await supabase.from("profiles").select("role").eq("user_id", session.user.id).maybeSingle();
  if (error) throw error;
  if (data?.role === "admin") return true;
  window.top.location.href = "cliente.html";
  return false;
}

function money(value) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value) || 0);
}

function safeImageUrl(value) {
  if (typeof value !== "string" || !value.trim()) return "assets/logo.png";
  if (value.startsWith("assets/") && !value.includes("..")) return value;
  try {
    const url = new URL(value, window.location.href);
    return url.protocol === "https:" ? url.href : "assets/logo.png";
  } catch {
    return "assets/logo.png";
  }
}

function empty(message) {
  const element = document.createElement("p");
  element.className = "empty-state";
  element.textContent = message;
  content.replaceChildren(element);
}

function makeOrder(order) {
  const article = document.createElement("article");
  article.className = "admin-view-order";
  const customer = document.createElement("div");
  const heading = document.createElement("h2");
  heading.textContent = `#${order.id.slice(0, 8).toUpperCase()} · ${order.profile?.full_name || "Cliente"}`;
  const date = document.createElement("p");
  const scheduledFor = order.scheduled_for ? new Date(order.scheduled_for).toLocaleString("pt-BR") : null;
  date.textContent = `${scheduledFor ? `Agendado para ${scheduledFor}` : new Date(order.created_at).toLocaleString("pt-BR")} · ${order.profile?.phone || "Sem telefone"}`;
  const address = document.createElement("p");
  address.textContent = [order.profile?.street, order.profile?.street_number, order.profile?.complement, order.profile?.neighborhood, order.profile?.city].filter(Boolean).join(", ") || "Endereço não informado";
  const items = document.createElement("p");
  items.textContent = (order.order_items || []).map((item) => `${item.quantity}× ${item.product_name}`).join(", ");
  customer.append(heading, date, address, items);
  const side = document.createElement("div");
  side.className = "admin-order-summary";
  const status = document.createElement("span");
  status.className = `status-badge${order.status === "cancelado" ? " is-cancelled" : ""}`;
  status.textContent = order.status.replaceAll("_", " ");
  const total = document.createElement("strong");
  total.textContent = money(order.total);
  const statusSelect = document.createElement("select");
  statusSelect.setAttribute("aria-label", `Status do pedido ${order.id.slice(0, 8)}`);
  [["recebido", "Recebido"], ["em_andamento", "Em andamento"], ["saiu_para_entrega", "Saiu para entrega"], ["pronto", "Pronto"], ["cancelado", "Cancelado"]].forEach(([value, label]) => {
    const option = new Option(label, value, false, order.status === value);
    statusSelect.add(option);
  });
  statusSelect.addEventListener("change", async () => {
    statusSelect.disabled = true;
    try {
      const { error } = await supabase.from("orders").update({ status: statusSelect.value }).eq("id", order.id);
      if (error) throw error;
      await loadView();
    } catch (error) {
      showError(error);
      statusSelect.value = order.status;
    } finally {
      statusSelect.disabled = false;
    }
  });
  side.append(status, total, statusSelect);
  const print = document.createElement("button");
  print.type = "button";
  print.className = "button button-outline";
  print.textContent = "Imprimir comanda";
  print.addEventListener("click", () => {
    window.parent.postMessage({ type: "admin:print-order", orderId: order.id }, window.location.origin);
  });
  side.append(print);
  article.append(customer, side);
  return article;
}

async function loadOrders(scheduled = false) {
  let query = supabase.from("orders")
    .select("id,status,total,created_at,scheduled_for,profile:profiles(full_name,phone,street,street_number,complement,neighborhood,city),order_items(product_name,quantity)")
    .order(scheduled ? "scheduled_for" : "created_at", { ascending: scheduled })
    .limit(100);
  query = scheduled
    ? query.not("scheduled_for", "is", null).gt("scheduled_for", new Date().toISOString())
    : query.is("scheduled_for", null);
  const { data, error } = await query;
  if (error) throw error;
  if (!data?.length) {
    empty(scheduled ? "Nenhum pedido agendado." : "Nenhum pedido recebido até o momento.");
    return;
  }
  content.replaceChildren(...data.map(makeOrder));
}

function makeMediaCard(product) {
  const card = document.createElement("article");
  card.className = "media-card";
  const image = document.createElement("img");
  image.src = safeImageUrl(product.image_url);
  image.alt = product.name;
  image.loading = "lazy";
  image.addEventListener("error", () => {
    if (image.getAttribute("src") !== "assets/logo.png") image.src = "assets/logo.png";
  });
  const name = document.createElement("strong");
  name.textContent = product.name;
  const state = document.createElement("small");
  state.textContent = product.is_active ? "Ativo" : "Inativo";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "button button-outline";
  copy.textContent = "Copiar URL";
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(product.image_url);
      copy.textContent = "Copiado";
    } catch (error) {
      showError(error);
    }
  });
  card.append(image, name, state, copy);
  return card;
}

async function loadMedia() {
  const [{ data: categories, error: categoriesError }, { data: products, error: productsError }] = await Promise.all([
    supabase.from("menu_categories").select("key,name,sort_order,is_active").order("sort_order"),
    supabase.from("products").select("name,image_url,category,is_active").not("image_url", "is", null).order("name").limit(500)
  ]);
  if (categoriesError) throw categoriesError;
  if (productsError) throw productsError;
  if (!categories?.length) return empty("Cadastre categorias no gestor do cardápio.");
  const toolbar = document.createElement("label");
  toolbar.className = "media-filter";
  toolbar.textContent = "Filtrar por categoria";
  const filter = document.createElement("select");
  filter.setAttribute("aria-label", "Filtrar imagens por categoria");
  filter.add(new Option("Todas as categorias", ""));
  categories.forEach((category) => filter.add(new Option(category.name, category.key)));
  toolbar.append(filter);
  const groups = document.createElement("div");
  groups.className = "media-category-list";
  const sections = [];
  categories.forEach((category, index) => {
    const section = document.createElement("section");
    section.className = "media-category";
    section.dataset.categoryKey = category.key;
    sections.push(section);
    const heading = document.createElement("header");
    heading.className = "media-category-heading";
    const title = document.createElement("h2");
    title.textContent = category.name;
    const controls = document.createElement("div");
    controls.className = "media-order-controls";
    const up = document.createElement("button");
    up.type = "button";
    up.className = "button button-outline";
    up.textContent = "↑ Subir";
    up.disabled = index === 0;
    up.setAttribute("aria-label", `Mover categoria ${category.name} para cima`);
    up.addEventListener("click", () => reorderCategory(categories, index, -1));
    const down = document.createElement("button");
    down.type = "button";
    down.className = "button button-outline";
    down.textContent = "↓ Descer";
    down.disabled = index === categories.length - 1;
    down.setAttribute("aria-label", `Mover categoria ${category.name} para baixo`);
    down.addEventListener("click", () => reorderCategory(categories, index, 1));
    controls.append(up, down);
    heading.append(title, controls);
    const items = (products || []).filter((product) => product.category === category.key);
    const grid = document.createElement("div");
    grid.className = "media-grid";
    if (items.length) grid.append(...items.map(makeMediaCard));
    else {
      const message = document.createElement("p");
      message.className = "empty-state media-empty";
      message.textContent = "Nenhuma imagem nesta categoria.";
      grid.append(message);
    }
    section.append(heading, grid);
    groups.append(section);
  });
  filter.addEventListener("change", () => {
    sections.forEach((section) => { section.hidden = Boolean(filter.value) && section.dataset.categoryKey !== filter.value; });
  });
  content.replaceChildren(toolbar, groups);
}

async function reorderCategory(categories, index, offset) {
  const target = index + offset;
  if (target < 0 || target >= categories.length) return;
  const reordered = [...categories];
  [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
  try {
    const results = await Promise.all(reordered.map((category, sort_order) =>
      supabase.from("menu_categories").update({ sort_order }).eq("key", category.key)
    ));
    const failed = results.find((result) => result.error);
    if (failed?.error) throw failed.error;
    await loadMedia();
  } catch (error) {
    showError(error);
  }
}

function orderSummary(order) {
  const lines = (order.order_items || []).map((item) => `${item.quantity}x ${item.product_name}`).join(", ");
  return [
    `Ferrari Delivery — pedido #${order.id.slice(0, 8).toUpperCase()}`,
    `Data: ${new Date(order.created_at).toLocaleString("pt-BR")}`,
    `Status: ${order.status.replaceAll("_", " ")}`,
    `Itens: ${lines}`,
    `Total: ${money(order.total)}`
  ].join("\n");
}

function makeHistoryOrder(order) {
  const article = makeOrder(order);
  article.classList.add("history-order");
  const actions = document.createElement("div");
  actions.className = "history-order-actions";
  const whatsapp = document.createElement("a");
  whatsapp.className = "button button-outline";
  whatsapp.href = `https://wa.me/?text=${encodeURIComponent(orderSummary(order))}`;
  whatsapp.target = "_blank";
  whatsapp.rel = "noopener noreferrer";
  whatsapp.textContent = "Compartilhar no WhatsApp";
  const share = document.createElement("button");
  share.type = "button";
  share.className = "button button-outline";
  share.textContent = "Compartilhar link";
  share.addEventListener("click", async () => {
    try {
      const shareData = { title: `Pedido #${order.id.slice(0, 8).toUpperCase()}`, text: orderSummary(order), url: new URL("cliente.html", window.location.href).href };
      if (navigator.share) await navigator.share(shareData);
      else {
        await navigator.clipboard.writeText(`${shareData.text}\n${shareData.url}`);
        share.textContent = "Link copiado";
      }
    } catch (error) {
      if (error.name !== "AbortError") showError(error);
    }
  });
  const print = document.createElement("button");
  print.type = "button";
  print.className = "button button-outline";
  print.textContent = "Imprimir segunda via";
  print.addEventListener("click", () => window.parent.postMessage(
    { type: "admin:print-order", orderId: order.id },
    window.location.origin
  ));
  actions.append(whatsapp, share, print);
  article.append(actions);
  return article;
}

async function loadHistory() {
  const { data, error } = await supabase.from("orders")
    .select("id,status,total,created_at,scheduled_for,profile:profiles(full_name,phone,street,street_number,complement,neighborhood,city),order_items(product_name,quantity,unit_price,line_total)")
    .order("created_at", { ascending: false })
    .limit(250);
  if (error) throw error;
  if (!data?.length) return empty("Ainda não há pedidos no histórico.");
  content.replaceChildren(...data.map(makeHistoryOrder));
}

async function loadBulkEditor() {
  const { data, error } = await supabase.from("products").select("id,name,category,price,promotional_price,stock,is_active").order("category").order("name").limit(500);
  if (error) throw error;
  if (!data?.length) return empty("Nenhum produto cadastrado.");
  const table = document.createElement("div");
  table.className = "bulk-table";
  const header = document.createElement("div");
  header.className = "bulk-row bulk-header";
  ["Produto", "Categoria", "Preço normal", "Promoção", "Estoque", "Disponibilidade", "Ação"].forEach((value) => {
    const cell = document.createElement("span");
    cell.textContent = value;
    header.append(cell);
  });
  table.append(header);
  data.forEach((product) => {
    const form = document.createElement("form");
    form.className = "bulk-row";
    const name = document.createElement("strong");
    name.textContent = product.name;
    const category = document.createElement("span");
    category.textContent = product.category;
    const price = document.createElement("input");
    price.type = "number";
    price.min = "0.01";
    price.step = "0.01";
    price.required = true;
    price.value = product.price;
    price.setAttribute("aria-label", `Preço de ${product.name}`);
    const promotionalPrice = document.createElement("input");
    promotionalPrice.type = "number";
    promotionalPrice.min = "0.01";
    promotionalPrice.step = "0.01";
    promotionalPrice.placeholder = "—";
    promotionalPrice.value = product.promotional_price ?? "";
    promotionalPrice.setAttribute("aria-label", `Preço promocional de ${product.name}`);
    const stock = document.createElement("input");
    stock.type = "number";
    stock.min = "0";
    stock.step = "1";
    stock.placeholder = "Ilimitado";
    stock.value = product.stock ?? "";
    stock.setAttribute("aria-label", `Estoque de ${product.name}`);
    const activeLabel = document.createElement("label");
    activeLabel.className = "bulk-active";
    const active = document.createElement("input");
    active.type = "checkbox";
    active.checked = product.is_active;
    const activeText = document.createTextNode(product.is_active ? "Ativo" : "Inativo");
    active.addEventListener("change", () => { activeText.textContent = active.checked ? "Ativo" : "Inativo"; });
    activeLabel.append(active, activeText);
    const save = document.createElement("button");
    save.type = "submit";
    save.className = "button button-outline";
    save.textContent = "Salvar";
    form.append(name, category, price, promotionalPrice, stock, activeLabel, save);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      save.disabled = true;
      try {
        const regular = Number(price.value);
        const promotion = Number(promotionalPrice.value) || null;
        if (promotion !== null && promotion >= regular) throw new Error(`O preço promocional de ${product.name} deve ser menor que o preço normal.`);
        const { error: updateError } = await supabase.from("products").update({
          price: regular,
          promotional_price: promotion,
          stock: stock.value === "" ? null : Number(stock.value),
          is_active: active.checked
        }).eq("id", product.id);
        if (updateError) throw updateError;
        save.textContent = "Salvo";
        window.setTimeout(() => { save.textContent = "Salvar"; }, 1400);
      } catch (error) {
        showError(error);
      } finally {
        save.disabled = false;
      }
    });
    table.append(form);
  });
  content.replaceChildren(table);
}

function addField(form, labelText, input) {
  const label = document.createElement("label");
  label.textContent = labelText;
  label.append(input);
  form.append(label);
}

async function loadPromotions() {
  const [{ data: products, error: productsError }, { data: promotions, error: promotionsError }] = await Promise.all([
    supabase.from("products").select("id,name,price,promotional_price").eq("is_active", true).order("name").limit(250),
    supabase.from("promotions").select("id,product_id,price,image_url,description,is_active,ends_at,product:products(name)").order("created_at", { ascending: false }).limit(100)
  ]);
  if (productsError) throw productsError;
  if (promotionsError) throw promotionsError;
  const section = document.createElement("section");
  section.className = "promotion-admin-panel";
  const form = document.createElement("form");
  form.className = "admin-promotion-form";
  const product = document.createElement("select");
  product.required = true;
  product.add(new Option("Selecione um produto", ""));
  products.forEach((item) => product.add(new Option(item.name, item.id)));
  addField(form, "Produto", product);
  const price = document.createElement("input");
  price.type = "number";
  price.min = "0.01";
  price.step = "0.01";
  price.required = true;
  addField(form, "Preço promocional (R$)", price);
  const image = document.createElement("input");
  image.type = "url";
  image.maxLength = 240;
  image.placeholder = "https://...";
  addField(form, "Imagem de destaque (opcional)", image);
  const endsAt = document.createElement("input");
  endsAt.type = "datetime-local";
  addField(form, "Fim da promoção (opcional)", endsAt);
  const promotionDescription = document.createElement("input");
  promotionDescription.maxLength = 240;
  promotionDescription.placeholder = "Texto exibido no carrossel";
  addField(form, "Texto da oferta (opcional)", promotionDescription);
  const save = document.createElement("button");
  save.type = "submit";
  save.className = "button button-primary";
  save.textContent = "Cadastrar promoção";
  form.append(save);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    save.disabled = true;
    try {
      const selectedProduct = products.find((item) => item.id === product.value);
      const currentPrice = Number(selectedProduct?.promotional_price || selectedProduct?.price);
      if (!selectedProduct || Number(price.value) >= currentPrice) {
        throw new Error("O preço da oferta deve ser menor que o preço atual do produto.");
      }
      if (image.value.trim() && new URL(image.value).protocol !== "https:") {
        throw new Error("Use um endereço HTTPS para a imagem da promoção.");
      }
      const { error } = await supabase.from("promotions").insert({
        product_id: product.value,
        price: Number(price.value),
        image_url: image.value.trim() || null,
        description: promotionDescription.value.trim() || null,
        ends_at: endsAt.value ? new Date(endsAt.value).toISOString() : null,
        is_active: true
      });
      if (error) throw error;
      await loadView();
    } catch (error) {
      showError(error);
    } finally {
      save.disabled = false;
    }
  });
  section.append(form);
  const list = document.createElement("div");
  list.className = "admin-promotion-list";
  promotions.forEach((promotion) => {
    const row = document.createElement("article");
    row.className = "admin-product-row";
    const detail = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = promotion.product?.name || "Produto removido";
    const state = document.createElement("small");
    state.textContent = `${money(promotion.price)} · ${promotion.is_active ? "Ativa" : "Inativa"}${promotion.ends_at ? ` · até ${new Date(promotion.ends_at).toLocaleString("pt-BR")}` : ""}`;
    detail.append(name, state);
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.textContent = promotion.is_active ? "Desativar" : "Ativar";
    toggle.addEventListener("click", async () => {
      toggle.disabled = true;
      try {
        const { error } = await supabase.from("promotions").update({ is_active: !promotion.is_active }).eq("id", promotion.id);
        if (error) throw error;
        await loadView();
      } catch (error) {
        showError(error);
      } finally {
        toggle.disabled = false;
      }
    });
    row.append(detail, toggle);
    list.append(row);
  });
  if (!promotions.length) {
    const message = document.createElement("p");
    message.className = "empty-state";
    message.textContent = "Nenhuma promoção cadastrada.";
    list.append(message);
  }
  section.append(list);
  content.replaceChildren(section);
}

async function loadView() {
  feedback.hidden = true;
  if (view === "orders") await loadOrders();
  else if (view === "scheduled") await loadOrders(true);
  else if (view === "history") await loadHistory();
  else if (view === "media") await loadMedia();
  else if (view === "bulk") await loadBulkEditor();
  else if (view === "promotions") await loadPromotions();
  else throw new Error("Área administrativa não encontrada.");
}

async function init() {
  initializeAdminTheme();
  if (!await requireAdmin()) return;
  const details = viewDetails[view] || viewDetails.orders;
  title.textContent = details[0];
  description.textContent = details[1];
  await loadView();
  window.addEventListener("message", (event) => {
    if (event.origin === window.location.origin && event.data?.type === "admin:orders-changed" && (view === "orders" || view === "scheduled")) {
      loadView().catch(showError);
    }
  });
}

init().catch(showError);
