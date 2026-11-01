import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./supabase-config.js";

const MASTER_ADMIN_ID = "0680c531-6f8e-4ad8-aae9-4de4206765ab";
const IMAGE_BUCKET = "menu-images";
const FALLBACK_IMAGE = "assets/logo-principal.png";
const supabase = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;
const categoryList = document.querySelector("[data-category-list]");
const categoryFilter = document.querySelector("[data-category-filter]");
const productDialog = document.querySelector("[data-product-dialog]");
const categoryDialog = document.querySelector("[data-category-dialog]");
const deleteProductDialog = document.querySelector("[data-delete-product-dialog]");
const productForm = document.querySelector("[data-product-form]");
const categoryForm = document.querySelector("[data-category-form]");
const deleteProductForm = document.querySelector("[data-delete-product-form]");
let categories = [];
let products = [];
let imageMode = "file";
let previewObjectUrl = null;
let showInactive = true;

function setFeedback(element, message, isError = false) {
  element.textContent = message;
  element.hidden = false;
  element.classList.toggle("is-error", isError);
}

function clearFeedback(element) {
  element.hidden = true;
  element.textContent = "";
  element.classList.remove("is-error");
}

function reportError(error, element = document.querySelector("[data-view-feedback]")) {
  console.error("Falha na gestão do cardápio.", error);
  setFeedback(element, error?.message || "Não foi possível concluir a operação. Tente novamente.", true);
}

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

async function requireAdmin() {
  if (!supabase) throw new Error("Configure o Supabase para acessar o gestor de cardápio.");
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

function imageUrl(value) {
  if (typeof value !== "string" || !value.trim()) return FALLBACK_IMAGE;
  if (value.startsWith("assets/") && !value.includes("..")) return value;
  try {
    const url = new URL(value, window.location.href);
    return url.protocol === "https:" ? url.href : FALLBACK_IMAGE;
  } catch {
    return FALLBACK_IMAGE;
  }
}

function makeImage(src, alt, className = "") {
  const image = document.createElement("img");
  image.src = imageUrl(src);
  image.alt = alt;
  image.loading = "lazy";
  image.className = className;
  image.addEventListener("error", () => {
    image.src = FALLBACK_IMAGE;
    image.onerror = null;
  }, { once: true });
  return image;
}

function fillCategorySelects() {
  const active = categories.filter((category) => category.is_active);
  const selectedFilter = categoryFilter.value;
  categoryFilter.replaceChildren(new Option("Todas as categorias", ""));
  active.forEach((category) => categoryFilter.add(new Option(category.name, category.key)));
  categoryFilter.value = active.some((category) => category.key === selectedFilter) ? selectedFilter : "";
  const productSelect = productForm.elements.category;
  const selectedProductCategory = productSelect.value;
  productSelect.replaceChildren(...active.map((category) => new Option(category.name, category.key)));
  if (active.some((category) => category.key === selectedProductCategory)) productSelect.value = selectedProductCategory;
}

function productMatches(product) {
  const query = document.querySelector("[data-product-search]").value.trim().toLocaleLowerCase("pt-BR");
  return (!query || product.name.toLocaleLowerCase("pt-BR").includes(query)) &&
    (!categoryFilter.value || product.category === categoryFilter.value) &&
    (showInactive || product.is_active);
}

function openDeleteProductConfirmation(product) {
  deleteProductForm.dataset.productId = product.id;
  document.querySelector("[data-delete-product-name]").textContent = product.name;
  clearFeedback(document.querySelector("[data-delete-product-feedback]"));
  deleteProductDialog.showModal();
}

async function deleteProduct(event) {
  event.preventDefault();
  const submit = deleteProductForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  clearFeedback(document.querySelector("[data-delete-product-feedback]"));
  try {
    const { error } = await supabase.from("products").delete().eq("id", deleteProductForm.dataset.productId);
    if (error) throw error;
    deleteProductDialog.close();
    await loadCatalog();
  } catch (error) {
    reportError(error, document.querySelector("[data-delete-product-feedback]"));
  } finally {
    submit.disabled = false;
  }
}

function makeProductRow(product) {
  const row = document.createElement("article");
  row.className = "catalog-product-row";
  row.dataset.productId = product.id;
  const drag = document.createElement("span");
  drag.className = "product-drag-handle";
  drag.textContent = "⠿";
  drag.draggable = true;
  drag.tabIndex = 0;
  drag.setAttribute("role", "button");
  drag.setAttribute("aria-label", `Arraste para reordenar ${product.name}`);
  drag.setAttribute("aria-keyshortcuts", "ArrowUp ArrowDown");
  drag.addEventListener("dragstart", (event) => {
    event.stopPropagation();
    event.dataTransfer.setData("text/plain", product.id);
    event.dataTransfer.effectAllowed = "move";
  });
  drag.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const offset = event.key === "ArrowUp" ? -1 : 1;
    const categoryProducts = products.filter((item) => item.category === product.category);
    const index = categoryProducts.findIndex((item) => item.id === product.id);
    const target = categoryProducts[index + offset];
    if (target) reorderProduct(product.id, target.id);
  });
  row.addEventListener("dragover", (event) => {
    event.stopPropagation();
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  });
  row.addEventListener("dragenter", (event) => {
    event.stopPropagation();
    row.classList.add("is-drop-target");
  });
  row.addEventListener("dragleave", (event) => {
    event.stopPropagation();
    if (!row.contains(event.relatedTarget)) row.classList.remove("is-drop-target");
  });
  row.addEventListener("drop", (event) => {
    event.stopPropagation();
    event.preventDefault();
    row.classList.remove("is-drop-target");
    reorderProduct(event.dataTransfer.getData("text/plain"), product.id);
  });
  drag.addEventListener("dragend", () => {
    document.querySelectorAll(".catalog-product-row.is-dragging, .catalog-product-row.is-drop-target")
      .forEach((item) => item.classList.remove("is-dragging", "is-drop-target"));
  });
  drag.addEventListener("dragstart", () => row.classList.add("is-dragging"));
  row.append(drag);
  row.append(makeImage(product.image_url, product.name, "catalog-product-image"));
  const details = document.createElement("div");
  details.className = "catalog-product-details";
  const name = document.createElement("strong");
  name.textContent = product.name;
  const description = document.createElement("p");
  description.textContent = product.description || "Sem descrição";
  const price = document.createElement("small");
  price.textContent = product.promotional_price
    ? `${money(product.promotional_price)} promocional · De ${money(product.price)}`
    : money(product.price);
  const state = document.createElement("span");
  state.className = `product-state${product.is_active ? "" : " is-inactive"}`;
  state.textContent = product.is_active ? "Ativo" : "Desativado";
  details.append(name, description, price);
  const actions = document.createElement("div");
  actions.className = "catalog-product-actions";
  const edit = document.createElement("button");
  edit.type = "button";
  edit.textContent = "Editar";
  edit.addEventListener("click", () => openProductEditor(product));
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.textContent = product.is_active ? "Desativar" : "Ativar";
  toggle.addEventListener("click", async () => {
    toggle.disabled = true;
    await updateProduct(product.id, { is_active: !product.is_active });
    toggle.disabled = false;
  });
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "catalog-product-delete";
  remove.textContent = "Excluir";
  remove.addEventListener("click", () => openDeleteProductConfirmation(product));
  actions.append(state, edit, toggle, remove);
  row.append(details, actions);
  return row;
}

async function reorderProduct(productId, targetProductId) {
  const from = products.findIndex((product) => product.id === productId);
  const target = products.findIndex((product) => product.id === targetProductId);
  if (from < 0 || target < 0 || from === target || products[from].category !== products[target].category) return;
  const category = products[from].category;
  const reordered = products.filter((product) => product.category === category);
  const fromIndex = reordered.findIndex((product) => product.id === productId);
  const targetIndex = reordered.findIndex((product) => product.id === targetProductId);
  [reordered[fromIndex], reordered[targetIndex]] = [reordered[targetIndex], reordered[fromIndex]];
  const categoryPositions = new Map(reordered.map((product, sortOrder) => [product.id, sortOrder]));
  products = products.map((product) => categoryPositions.has(product.id)
    ? { ...product, sort_order: categoryPositions.get(product.id) }
    : product);
  renderCategories();
  try {
    const results = await Promise.all(reordered.map((product, sort_order) =>
      supabase.from("products").update({ sort_order }).eq("id", product.id)
    ));
    const failed = results.find((result) => result.error);
    if (failed?.error) throw failed.error;
    await loadCatalog();
  } catch (error) {
    try {
      await loadCatalog();
    } catch (reloadError) {
      console.error("Não foi possível recarregar a ordem dos produtos.", reloadError);
    }
    reportError(error);
  }
}

function persistCategoryOrder() {
  const updates = categories.map((category, index) =>
    supabase.from("menu_categories").update({ sort_order: index }).eq("key", category.key)
  );
  Promise.all(updates).then((results) => {
    const failed = results.find((result) => result.error);
    if (failed?.error) throw failed.error;
    return loadCatalog();
  }).catch(reportError);
}

function moveCategory(key, offset) {
  const index = categories.findIndex((category) => category.key === key);
  const target = index + offset;
  if (index < 0 || target < 0 || target >= categories.length) return;
  [categories[index], categories[target]] = [categories[target], categories[index]];
  renderCategories();
  persistCategoryOrder();
}

function makeCategoryCard(category, index, visibleCategories) {
  const card = document.createElement("article");
  card.className = `category-card${category.is_active ? "" : " is-inactive"}`;
  card.draggable = true;
  card.dataset.categoryKey = category.key;
  card.addEventListener("dragstart", (event) => {
    if (event.target.closest(".catalog-product-row")) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.setData("text/plain", category.key);
    event.dataTransfer.effectAllowed = "move";
  });
  card.addEventListener("dragover", (event) => {
    if (event.target.closest(".catalog-product-row")) return;
    event.preventDefault();
  });
  card.addEventListener("drop", (event) => {
    if (event.target.closest(".catalog-product-row")) return;
    event.preventDefault();
    const draggedKey = event.dataTransfer.getData("text/plain");
    const from = categories.findIndex((item) => item.key === draggedKey);
    const to = categories.findIndex((item) => item.key === category.key);
    if (from < 0 || to < 0 || from === to) return;
    const [dragged] = categories.splice(from, 1);
    categories.splice(to, 0, dragged);
    renderCategories();
    persistCategoryOrder();
  });

  const heading = document.createElement("header");
  heading.className = "category-card-heading";
  const titleGroup = document.createElement("div");
  titleGroup.className = "category-title-group";
  const drag = document.createElement("span");
  drag.className = "category-drag-handle";
  drag.textContent = "⠿";
  drag.setAttribute("aria-label", "Arraste para reordenar a categoria");
  const title = document.createElement("h2");
  title.textContent = category.name;
  const tag = document.createElement("span");
  tag.className = "category-tag";
  tag.textContent = category.tag || `${visibleCategories.length} ${visibleCategories.length === 1 ? "item" : "itens"}`;
  titleGroup.append(drag, title, tag);
  const actions = document.createElement("div");
  actions.className = "category-heading-actions";
  const add = document.createElement("button");
  add.type = "button";
  add.className = "button button-primary";
  add.textContent = "+ Adicionar item";
  add.addEventListener("click", () => openProductEditor(null, category.key));
  const menu = document.createElement("details");
  menu.className = "category-actions-menu";
  menu.innerHTML = '<summary aria-label="Ações categoria">•••</summary>';
  const menuItems = document.createElement("div");
  const editCategory = document.createElement("button");
  editCategory.type = "button";
  editCategory.textContent = "Editar nome e identificação";
  editCategory.addEventListener("click", () => openCategoryEditor(category));
  const moveUp = document.createElement("button");
  moveUp.type = "button";
  moveUp.textContent = "Reordenar para cima";
  moveUp.disabled = index === 0;
  moveUp.addEventListener("click", () => moveCategory(category.key, -1));
  const moveDown = document.createElement("button");
  moveDown.type = "button";
  moveDown.textContent = "Reordenar para baixo";
  moveDown.disabled = index === categories.length - 1;
  moveDown.addEventListener("click", () => moveCategory(category.key, 1));
  const deactivate = document.createElement("button");
  deactivate.type = "button";
  deactivate.textContent = category.is_active ? "Desativar categoria" : "Ativar categoria";
  deactivate.addEventListener("click", () => updateCategory(category, { is_active: !category.is_active }));
  menuItems.append(editCategory, moveUp, moveDown, deactivate);
  menu.append(menuItems);
  actions.append(menu, add);
  heading.append(titleGroup, actions);
  const body = document.createElement("div");
  body.className = "category-product-list";
  if (!visibleCategories.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Nenhum produto nesta categoria. Adicione o primeiro item.";
    body.append(empty);
  } else {
    body.append(...visibleCategories.map(makeProductRow));
  }
  card.append(heading, body);
  return card;
}

function renderCategories() {
  fillCategorySelects();
  categoryList.replaceChildren();
  const visible = categories.filter((category) =>
    (showInactive || category.is_active) && (!categoryFilter.value || category.key === categoryFilter.value)
  );
  visible.forEach((category, index) => {
    const filteredProducts = products.filter((product) => product.category === category.key && productMatches(product));
    if (categoryFilter.value || !document.querySelector("[data-product-search]").value.trim() || filteredProducts.length) {
      categoryList.append(makeCategoryCard(category, categories.indexOf(category), filteredProducts));
    }
  });
  if (!categoryList.children.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Nenhuma categoria ou produto corresponde aos filtros.";
    categoryList.append(empty);
  }
}

async function loadCatalog() {
  clearFeedback(document.querySelector("[data-view-feedback]"));
  const [{ data: categoryData, error: categoryError }, { data: productData, error: productError }] = await Promise.all([
    supabase.from("menu_categories").select("key,name,tag,is_active,sort_order").order("sort_order"),
    supabase.from("products").select("id,name,description,price,promotional_price,image_url,category,is_active,complements,stock,sort_order").order("category").order("sort_order").order("name").limit(500)
  ]);
  if (categoryError) throw categoryError;
  if (productError) throw productError;
  categories = categoryData || [];
  products = productData || [];
  renderCategories();
}

function openProductEditor(product = null, categoryKey = "") {
  clearFeedback(document.querySelector("[data-product-feedback]"));
  productForm.reset();
  document.querySelector("[data-image-file-name]").textContent = "Nenhum arquivo selecionado";
  productForm.elements.id.value = product?.id || "";
  productForm.elements.name.value = product?.name || "";
  productForm.elements.category.value = product?.category || categoryKey || categories.find((item) => item.is_active)?.key || "";
  productForm.elements.description.value = product?.description || "";
  productForm.elements.price.value = product?.price ?? "";
  productForm.elements.promotional_price.value = product?.promotional_price ?? "";
  productForm.elements.complements.value = Array.isArray(product?.complements) ? product.complements.join("\n") : "";
  productForm.elements.active.checked = product?.is_active ?? true;
  productForm.elements.image_url.value = product?.image_url && !product.image_url.startsWith("assets/") ? product.image_url : "";
  productForm.dataset.currentImage = product?.image_url || "";
  document.querySelector("[data-image-preview]").src = imageUrl(product?.image_url);
  setImageMode("file");
  productDialog.showModal();
  productForm.elements.name.focus();
}

function openCategoryEditor(category = null) {
  clearFeedback(document.querySelector("[data-category-feedback]"));
  categoryForm.reset();
  categoryForm.elements.key.value = category?.key || "";
  categoryForm.elements.name.value = category?.name || "";
  categoryForm.elements.tag.value = category?.tag || "";
  document.querySelector("#category-dialog-title").textContent = category ? "Editar categoria" : "Nova categoria";
  categoryDialog.showModal();
  categoryForm.elements.name.focus();
}

function setImageMode(mode) {
  imageMode = mode;
  document.querySelectorAll("[data-image-mode]").forEach((button) => {
    const active = button.dataset.imageMode === mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  document.querySelector("[data-file-image-field]").hidden = mode !== "file";
  document.querySelector("[data-url-image-field]").hidden = mode !== "url";
}

function setPreview(src, label) {
  const preview = document.querySelector("[data-image-preview]");
  preview.src = typeof src === "string" && src.startsWith("blob:") ? src : imageUrl(src);
  document.querySelector("[data-image-preview-label]").textContent = label;
}

async function uploadProductImage(file) {
  if (!file) return null;
  if (!file.type.startsWith("image/")) throw new Error("Selecione um arquivo de imagem válido.");
  if (file.size > 5 * 1024 * 1024) throw new Error("A imagem deve ter no máximo 5 MB.");
  const extension = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type });
  if (error) throw error;
  const { data } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path);
  return { path, url: data.publicUrl };
}

async function saveProduct(event) {
  event.preventDefault();
  const submit = productForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  clearFeedback(document.querySelector("[data-product-feedback]"));
  let uploadedImagePath = null;
  try {
    const values = new FormData(productForm);
    const regularPrice = Number(values.get("price"));
    const promotionalPrice = Number(values.get("promotional_price")) || null;
    const name = String(values.get("name") || "").trim();
    const category = String(values.get("category") || "");
    const id = String(values.get("id") || "");
    if (promotionalPrice !== null && promotionalPrice >= regularPrice) throw new Error("O preço promocional deve ser menor que o preço normal.");
    let duplicateQuery = supabase.from("products").select("id").eq("category", category).eq("name", name);
    if (id) duplicateQuery = duplicateQuery.neq("id", id);
    const { data: duplicate, error: duplicateError } = await duplicateQuery.maybeSingle();
    if (duplicateError) throw duplicateError;
    if (duplicate) throw new Error("Já existe um produto com esse nome nesta categoria.");
    const file = productForm.elements.image_file.files[0];
    let image = String(values.get("image_url") || "").trim();
    if (imageMode === "file") {
      const upload = await uploadProductImage(file);
      uploadedImagePath = upload?.path || null;
      image = upload?.url || productForm.dataset.currentImage || "";
    }
    if (imageMode === "url" && image && new URL(image).protocol !== "https:") {
      throw new Error("Use um endereço HTTPS para a imagem.");
    }
    if (image && image.length > 2048) throw new Error("O endereço da imagem excede o limite permitido.");
    const product = {
      name,
      category,
      description: String(values.get("description") || "").trim() || null,
      price: regularPrice,
      promotional_price: promotionalPrice,
      image_url: image || null,
      is_active: productForm.elements.active.checked,
      complements: String(values.get("complements") || "").split("\n").map((item) => item.trim()).filter(Boolean),
      sort_order: id && products.find((item) => item.id === id)?.category === category
        ? products.find((item) => item.id === id).sort_order
        : products.filter((item) => item.category === category)
          .reduce((max, item) => Math.max(max, item.sort_order ?? -1), -1) + 1
    };
    const result = id
      ? await supabase.from("products").update(product).eq("id", id)
      : await supabase.from("products").insert(product);
    if (result.error) throw result.error;
    uploadedImagePath = null;
    productDialog.close();
    await loadCatalog();
  } catch (error) {
    if (uploadedImagePath) {
      try {
        const { error: cleanupError } = await supabase.storage.from(IMAGE_BUCKET).remove([uploadedImagePath]);
        if (cleanupError) throw cleanupError;
      } catch (cleanupError) {
        console.error("Não foi possível remover a imagem após falha ao salvar o produto.", cleanupError);
        error = new Error(
          `${error?.message || "Não foi possível salvar o produto."} A imagem enviada também não pôde ser removida.`
        );
      }
    }
    reportError(error, document.querySelector("[data-product-feedback]"));
  } finally {
    submit.disabled = false;
  }
}

async function saveCategory(event) {
  event.preventDefault();
  const submit = categoryForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  clearFeedback(document.querySelector("[data-category-feedback]"));
  try {
    const values = new FormData(categoryForm);
    const name = String(values.get("name") || "").trim();
    const key = String(values.get("key") || "") || name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (!key) throw new Error("Informe um nome válido para a categoria.");
    const existing = String(values.get("key") || "");
    const result = existing
      ? await supabase.from("menu_categories").update({ name, tag: String(values.get("tag") || "").trim() || null }).eq("key", existing)
      : await supabase.from("menu_categories").insert({ key, name, tag: String(values.get("tag") || "").trim() || null, sort_order: categories.length });
    if (result.error) throw result.error;
    categoryDialog.close();
    await loadCatalog();
  } catch (error) {
    reportError(error, document.querySelector("[data-category-feedback]"));
  } finally {
    submit.disabled = false;
  }
}

async function updateProduct(id, changes) {
  try {
    const { error } = await supabase.from("products").update(changes).eq("id", id);
    if (error) throw error;
    await loadCatalog();
  } catch (error) {
    reportError(error);
  }
}

async function updateCategory(category, changes) {
  try {
    const { error } = await supabase.from("menu_categories").update(changes).eq("key", category.key);
    if (error) throw error;
    await loadCatalog();
  } catch (error) {
    reportError(error);
  }
}

function bindEvents() {
  document.querySelector("[data-new-category]").addEventListener("click", () => openCategoryEditor());
  document.querySelector("[data-product-search]").addEventListener("input", renderCategories);
  categoryFilter.addEventListener("change", renderCategories);
  document.querySelector("[data-refresh]").addEventListener("click", () => loadCatalog().catch(reportError));
  document.querySelector("[data-open-promotions]").addEventListener("click", () => {
    window.parent.postMessage({ type: "admin:navigate-view", view: "promotions" }, window.location.origin);
  });
  document.querySelector("[data-toggle-inactive]").addEventListener("click", (event) => {
    showInactive = !showInactive;
    event.currentTarget.textContent = showInactive ? "Ocultar inativos" : "Mostrar inativos";
    renderCategories();
  });
  document.querySelector("[data-toggle-inactive]").textContent = "Ocultar inativos";
  document.querySelectorAll("[data-image-mode]").forEach((button) => button.addEventListener("click", () => setImageMode(button.dataset.imageMode)));
  document.querySelector("[data-choose-image]").addEventListener("click", () => document.querySelector("[data-image-file]").click());
  document.querySelector("[data-image-file]").addEventListener("change", (event) => {
    const [file] = event.currentTarget.files;
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = file ? URL.createObjectURL(file) : null;
    document.querySelector("[data-image-file-name]").textContent = file?.name || "Nenhum arquivo selecionado";
    if (previewObjectUrl) setPreview(previewObjectUrl, file.name);
    else setPreview(productForm.dataset.currentImage, "Prévia da imagem");
  });
  productForm.elements.image_url.addEventListener("input", (event) => setPreview(event.currentTarget.value, "Prévia da URL"));
  const preview = document.querySelector("[data-image-preview]");
  preview.addEventListener("error", () => {
    if (preview.getAttribute("src") !== FALLBACK_IMAGE) preview.src = FALLBACK_IMAGE;
  });
  productForm.addEventListener("submit", saveProduct);
  categoryForm.addEventListener("submit", saveCategory);
  deleteProductForm.addEventListener("submit", deleteProduct);
  document.querySelector("[data-close-product]").addEventListener("click", () => productDialog.close());
  document.querySelector("[data-cancel-product]").addEventListener("click", () => productDialog.close());
  document.querySelector("[data-close-category]").addEventListener("click", () => categoryDialog.close());
  document.querySelector("[data-cancel-category]").addEventListener("click", () => categoryDialog.close());
  document.querySelector("[data-cancel-delete-product]").addEventListener("click", () => deleteProductDialog.close());
  productDialog.addEventListener("close", () => {
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = null;
  });
}

async function init() {
  initializeAdminTheme();
  if (!await requireAdmin()) return;
  bindEvents();
  await loadCatalog();
}

init().catch(reportError);
