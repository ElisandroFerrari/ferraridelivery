const porcoes = [
    { n: "Proteína extra do prato do dia", p: "10,00" },
    { n: "Arroz", p: "8,00" },
    { n: "Feijão", p: "8,00" },
    { n: "Massa", p: "8,00" },
    { n: "Batata frita", p: "10,00" },
    { n: "Ovo frito", p: "3,00" },
    { n: "Cebola na chapa", p: "7,00" },
    { n: "Filé de frango simples", p: "10,00" },
    { n: "Bife de gado acebolado", p: "15,00" },
    { n: "Filé de frango acebolado", p: "15,00" },
    { n: "Bife de gado à milanesa", p: "15,00" },
    { n: "Filé de frango à milanesa", p: "15,00" },
    { n: "Filé de peixe à dorê", p: "10,00" },
    { n: "Filé de peixe à milanesa", p: "15,00" },
    { n: "Bife de gado simples", p: "10,00" }
];

// 1. CONFIGURAÇÃO FIREBASE
const firebaseConfig = {
    apiKey: "AIzaSyBfcG9ufmu8GiKySmU4iI_LKDColpL_9e4",
    authDomain: "ferraridelivery.firebaseapp.com",
    databaseURL: "https://ferraridelivery-default-rtdb.firebaseio.com",
    projectId: "ferraridelivery",
    storageBucket: "ferraridelivery.firebasestorage.app",
    messagingSenderId: "547578581344",
    appId: "1:547578581344:web:98df544ed4f33bdb98ce05"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

let contador = 0;

// 2. FUNÇÃO ADMIN
function tentarAdmin() {
    contador++;
    if (contador >= 5) {
        let senha = prompt("Digite a senha do administrador:");
        if (senha === "master45") {
            document.getElementById('painel-admin').style.display = 'block';
            alert("Acesso liberado!");
        } else {
            alert("Senha incorreta!");
        }
        contador = 0;
    }
}

// 3. SALVAR NO FIREBASE
function salvarAdmin() {
    const novosDados = {
        promo: {
            n: document.getElementById('in-promo-n').value,
            p: document.getElementById('in-promo-p').value,
            d: document.getElementById('in-promo-d').value
        },
        eco: {
            n: document.getElementById('in-eco-n').value,
            p: document.getElementById('in-eco-p').value,
            d: document.getElementById('in-eco-d').value
        },
        exe: {
            n: document.getElementById('in-exe-n').value,
            p: document.getElementById('in-exe-p').value,
            d: document.getElementById('in-exe-d').value
        }
    };
    db.ref('cardapio').set(novosDados).then(() => alert("✅ Cardápio Atualizado!"));
}

// 4. CARREGAR DADOS
function carregarDados() {
const pContainer = document.getElementById('container-porcoes');
    if(pContainer) {
        pContainer.innerHTML = porcoes.map(item => `
            <div class="item">
                <div class="item-info">
                    <h3>${item.n}</h3>
                    <div class="preco">R$ ${item.p}</div>
                </div>
            </div>
        `).join('');
    }
    db.ref('cardapio').on('value', (snapshot) => {
        const dados = snapshot.val();
        if (dados) {
            document.getElementById('display-promo-nome').innerText = dados.promo.n;
            document.getElementById('display-promo-preco').innerText = "R$ " + dados.promo.p;
            document.getElementById('display-eco-nome').innerText = dados.eco.n;
            document.getElementById('display-eco-preco').innerText = "R$ " + dados.eco.p;
            document.getElementById('display-exe-nome').innerText = dados.exe.n;
            document.getElementById('display-exe-preco').innerText = "R$ " + dados.exe.p;

            // Preenche campos admin
            document.getElementById('in-promo-n').value = dados.promo.n;
            document.getElementById('in-promo-p').value = dados.promo.p;
            document.getElementById('in-promo-d').value = dados.promo.d;

            window.dadosFirebase = dados;
        }
    });
}

// 5. MODAL E BUSCA
function abrirModalDia(tipo) {
    if (!window.dadosFirebase) return;
    const item = window.dadosFirebase[tipo];
    abrirModal(item.n, item.d);
}

function abrirModal(titulo, detalhes) {
    document.getElementById("modalTitulo").innerText = titulo;
    document.getElementById("modalCorpo").innerText = detalhes;
    document.getElementById("meuModal").style.display = "block";
}

function fecharModal() {
    document.getElementById("meuModal").style.display = "none";
}

function compartilhar() {
    if (navigator.share) {
        navigator.share({
            title: 'Ferrari Delivery - Cardápio',
            text: 'Confira nosso cardápio de hoje!',
            url: window.location.href
        }).catch(console.error);
    } else {
        alert("Link copiado: " + window.location.href);
    }
}