# ProvaScan: configuração inicial do Google Drive

Esta versão foi preparada para usar o Google Drive como armazenamento principal, sem Firebase. O site permanece no GitHub Pages; cadastros e correções vão para a conta Google escolhida pelo usuário.

A conexão real requer um **ID público de cliente OAuth Web**, criado em um projeto Google Cloud sob controle do proprietário. Uma pasta compartilhada ou uma chave de API isolada não substitui essa autorização.

1. Entre no [Google Cloud Console](https://console.cloud.google.com/) com a conta que administrará o ProvaScan e crie ou selecione um projeto.
2. Na biblioteca de APIs, ative a **Google Drive API**.
3. Configure o Google Auth Platform / tela de consentimento: nome ProvaScan, seu contato de suporte e audiência apropriada. Para teste pessoal com conta Gmail, use audiência externa em teste e cadastre seu próprio e-mail como usuário de teste. Contas institucionais podem ter restrições do administrador.
4. Declare o escopo `https://www.googleapis.com/auth/drive.file`. Ele permite trabalhar com os arquivos criados/autorizados para o ProvaScan, sem acesso geral a todo o Drive.
5. Crie um cliente OAuth do tipo **Aplicativo da Web**. Em origens JavaScript autorizadas, cadastre exatamente `https://marciomarx.github.io` (sem `/provascan/`). Esta implementação usa a janela de autorização do Google Identity Services; não há callback de servidor a configurar.
6. Copie o **ID do cliente** terminado em `.apps.googleusercontent.com`. Não copie nem envie o segredo do cliente, senha, token ou código de recuperação.
7. Para configuração definitiva, preencha `clientId` em `drive-config.js` e publique. O mesmo ID deve ser usado no notebook e no celular. Para testar antes dessa publicação, a seção “Configuração inicial da conexão” do app aceita esse ID público e o guarda somente naquele navegador.
8. Se a configuração do Google solicitar página inicial, política de privacidade ou domínio, use o endereço público do aplicativo e `https://marciomarx.github.io/provascan/privacy.html`. A publicação para outros usuários depende das exigências que o Google apresentar para o projeto; a configuração de teste não equivale a essa publicação.

## Primeira migração

Exporte o backup JSON de cada aparelho antes da primeira conexão. No notebook, conecte a conta escolhida e confirme a reunião dos dados locais. Aguarde “Tudo sincronizado”. No celular, use o mesmo ID de cliente e a mesma conta e repita o processo. Registros com IDs diferentes são preservados separadamente; nomes iguais não são apagados nem fundidos por suposição.

Se o mesmo registro tiver duas alterações diferentes, o aplicativo destaca o conflito e permite escolher a versão a manter. O histórico conserva ambas. Exclusões são registradas por revisão; se uma exclusão concorrer com um registro novo dependente, o app solicita restauração do vínculo.

## Funcionamento e limites desta entrega

- O acesso ao Google ocorre por botão, exigência do fluxo de autorização do navegador. O app apresenta esse botão ao abrir; não abre uma janela de login automaticamente sem interação.
- Tokens ficam apenas em memória e expiram. Reconecte quando solicitado. Não há servidor nem segredo de cliente dentro do site.
- Dados pendentes ficam no navegador e são enviados ao reconectar. “Drive desconectado” não significa sincronizado.
- A pasta ProvaScan/Dados contém arquivos de alterações imutáveis. Não edite nem remova esses arquivos manualmente. A leitura reúne as revisões e evita sobrescrever todo o cadastro com uma cópia antiga.
- Registros são separados por turma, aluno, avaliação e correção. Há sincronização automática após salvar, ao voltar à janela, ao recuperar a rede e a cada minuto enquanto a página está visível, além do botão Sincronizar agora.
- A sincronização aguarda o fechamento da captura/conferência da câmera para preservar o contexto da correção.
- Trocar de conta não importa os dados da conta anterior para a nova conta.
- Fotos da câmera não são enviadas nesta versão. As notas não são enviadas aos alunos.
- Históricos muito grandes exigirão uma etapa futura de compactação; esta versão preserva todas as revisões e usa cache local dos arquivos já lidos.
- A integração foi testada com simulações da API. **A validação real com duas sessões Google depende da credencial e da autorização do proprietário.**

Referências oficiais: [Google Identity Services](https://developers.google.com/identity/oauth2/web/guides/use-token-model), [escopos do Drive](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [upload de arquivos](https://developers.google.com/workspace/drive/api/guides/manage-uploads).
