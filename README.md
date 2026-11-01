# Ferrari Delivery

Aplicação de delivery em HTML/CSS/JavaScript nativo, organizada como MPA. O catálogo, a autenticação e os painéis de cliente e administração usam Supabase; o navegador contém somente a chave pública `anon`, com autorização aplicada por RLS.

## Páginas

- `index.html`: apresentação e acesso à loja.
- `login.html`: login e cadastro de clientes.
- `cliente.html`: ofertas, catálogo por categoria, carrinho e histórico do cliente.
- `admin.html`: painel administrativo modular com cabeçalho operacional, sidebar recolhível por hover ou botão hambúrguer e conteúdo em `iframe`.
- `gestor-cardapio.html` / `gestor-cardapio.js`: categorias isoladas, produtos, upload de imagens, preços promocionais e complementos.
- `admin-view.html` / `admin-view.js`: pedidos, histórico com compartilhamento/impressão, imagens por categoria e edição em massa.
- `styles.css` e `app.js`: apresentação responsiva e interações comuns.
- `supabase/schema.sql`: tabelas, índices, políticas RLS, RPC segura de pedidos e dados iniciais.
- `supabase/functions/whatsapp-notifications`: função de notificações transacionais por WhatsApp.

## Configuração do Supabase

1. Crie um projeto Supabase e execute `supabase/schema.sql` no SQL Editor do projeto.
   Em projetos já configurados, aplique os arquivos de `supabase/migrations` em ordem no SQL Editor. A migração `20261031190000_admin_catalog.sql` adiciona categorias editáveis, preços promocionais, estoque, complementos, agendamento de pedidos e o bucket público de imagens do cardápio. A migração `20261101220000_shop_settings.sql` adiciona expediente, almoço/noite, status público da loja e atualização em tempo real. A migração `20261101230000_product_availability.sql` permite mostrar produtos inativos como indisponíveis para clientes e insere alaminutas do catálogo-base apenas se estiverem ausentes. A migração `20261101240000_product_sort_order.sql` adiciona a ordenação personalizada dos produtos. A migração `20261101250000_is_admin_permissions.sql` corrige o retorno e as permissões da função administrativa.
2. Em `supabase-config.js`, preencha `SUPABASE_URL` e `SUPABASE_ANON_KEY` com a URL do projeto e a chave **anon/publishable**. Essa chave é pública por definição; as políticas RLS limitam seu acesso.
3. Configure a autenticação por e-mail em **Authentication → Providers**. Se a confirmação de e-mail estiver ativa, o cliente precisará confirmar o endereço antes do login.
4. Cadastre uma conta de cliente e promova somente a conta do proprietário para administrador pelo SQL Editor, substituindo o e-mail:

   ```sql
   update public.profiles
   set role = 'admin'
   where user_id = '0680c531-6f8e-4ad8-aae9-4de4206765ab';
   ```

   O administrador master também é reconhecido pelo UUID fixo acima. A atribuição é validada pelo banco, e clientes não podem alterar seu próprio papel.

5. Publique os arquivos em um host estático com HTTPS. Abra `index.html` pelo host, não por `file://`.

## Notificações de WhatsApp

As notificações são opcionais e só são geradas para clientes que marcarem o consentimento no formulário de endereço. A tabela `notification_outbox` recebe eventos de criação e alteração de status por trigger do banco. O token da Meta nunca vai para o front-end.

1. Publique a função: `supabase functions deploy whatsapp-notifications`.
2. Cadastre os segredos no ambiente Supabase Functions (não no repositório nem no navegador):

   ```text
   ORDER_WEBHOOK_SECRET=<segredo-aleatorio-com-pelo-menos-32-caracteres>
   WHATSAPP_ACCESS_TOKEN=<token-de-acesso-da-meta>
   WHATSAPP_PHONE_NUMBER_ID=<id-do-numero-de-envio>
   WHATSAPP_TEMPLATE_NAME=<nome-do-template-aprovado>
   WHATSAPP_TEMPLATE_LANGUAGE=pt_BR
   WHATSAPP_GRAPH_API_VERSION=v22.0
   ```

3. No painel Supabase, crie um **Database Webhook** para `public.notification_outbox`, evento `INSERT`, método `POST`, apontando para `https://<project-ref>.supabase.co/functions/v1/whatsapp-notifications`. Configure o cabeçalho `x-webhook-secret` com o mesmo `ORDER_WEBHOOK_SECRET`.
4. Cadastre e aprove na Meta um template de WhatsApp com dois parâmetros de corpo: número curto do pedido e texto do status. O nome e o idioma devem corresponder aos segredos acima.

A função não recebe solicitações autenticadas pelo cliente: ela valida o segredo específico do webhook, usa os tokens somente no servidor e registra falhas de entrega nos logs da função.

## Operação

- O preço final de cada pedido é recalculado no RPC `place_order`; preço, total e itens enviados pelo navegador não são confiáveis.
- As categorias do cardápio são compartilhadas com o catálogo do cliente. O RPC valida e baixa o estoque disponível de forma transacional; imagens locais são enviadas ao bucket público `menu-images`, com gravação restrita a administradores.
- O RPC exige perfil de entrega completo e aplica intervalo mínimo de 30 segundos entre pedidos da mesma conta.
- O perfil do cliente permite atualizar nome, telefone, rua, número, complemento, bairro e cidade, carregar uma foto e escolher tema claro/escuro. A foto é recortada/posicionada no navegador, armazenada em bucket privado e servida com URL temporária; o cliente só acessa seu próprio arquivo.
- O carrinho aparece como lista no painel do cliente, com preço unitário e subtotal, controles de quantidade e remoção de itens.
- Cliente só consulta o próprio perfil, pedidos e itens. A autorização administrativa é conferida no banco usando o papel protegido em `profiles.role`, o UUID master e, para compatibilidade, `app_metadata.role`; produtos podem ser lidos publicamente para indicar disponibilidade, mas somente produtos ativos podem ser pedidos, conforme validação do RPC `place_order`. Promoções permanecem públicas apenas quando ativas.
- O painel acompanha novos pedidos por Supabase Realtime, toca um alerta após interação do administrador com a página e abre a comanda formatada para impressão quando um pedido chega. A impressão usa a caixa de diálogo padrão do navegador; selecione/configure a impressora térmica como padrão. A segunda via pode ser reimpressa pelo histórico.
- Produtos e históricos usam paginação. Imagens do catálogo são carregadas sob demanda.
- No gestor, desativar mantém o produto cadastrado e disponível para reativação; a exclusão é uma ação separada com confirmação. Produtos desativados ou sem estoque aparecem ao cliente com imagem desfocada e o aviso “Em falta”.
- A ordem dos produtos pode ser ajustada arrastando a alça de seis pontos ou focando-a e usando as setas para cima/baixo. A ordem é salva por categoria e também exibida no catálogo do cliente.
- O cabeçalho do admin oferece acesso às configurações, notificações e controle de impressão. O tema do painel é salvo no navegador; o envio automático por WhatsApp depende da Edge Function configurada no Supabase.
- O botão de configurações fica após o controle de impressão. Os indicadores de pedidos ficam vermelhos sem pedidos e verdes quando há pedidos; a sidebar recolhe para ícones e expande ao passar o mouse ou pelo botão hambúrguer.
- O horário, pausa de almoço, período noturno e status manual da loja ficam em `store_settings`, que pode ser lido publicamente e editado somente por administradores. O cliente recebe atualizações em tempo real; o tema do painel é salvo localmente por navegador.
- Nenhuma `service_role key`, senha administrativa ou token da Meta deve ser incluído em arquivos estáticos.
