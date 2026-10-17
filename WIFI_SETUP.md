# ProvaScan pelo Wi-Fi — versão local 0.9.0

O notebook é o servidor e a autoridade dos dados. Não há Google Drive, Firebase ou serviço cobrado por utilização nesta versão. O site público 0.8.1 permanece disponível durante a migração. Não desconecte o Drive nem apague dados antes de conferir a migração.

## 1. Preservar os dados atuais

No app atual, sincronize os aparelhos e use **Exportar backup** no notebook e no celular. Guarde os dois arquivos com nomes diferentes. Não limpe o armazenamento do navegador. Os dados do endereço público não aparecem automaticamente no endereço local: será necessário importar o backup.

## 2. Instalar no Windows

1. Baixe o projeto: https://github.com/marciomarx/provascan/archive/refs/heads/main.zip
2. Extraia o ZIP em uma pasta permanente, por exemplo `Documentos\ProvaScan`. Não execute dentro do ZIP.
3. Instale Python 3.12 ou superior pelo instalador oficial https://www.python.org/downloads/windows/ (inclua o Python Launcher).
4. Abra **Iniciar-ProvaScan-WiFi.bat**. Na primeira vez, ele prepara as dependências. Precisa de internet somente para essa instalação e futuras verificações de atualização.
5. Confira o certificado pessoal e autorize sua instalação no Windows quando solicitado. O certificado é gerado exclusivamente neste notebook.
6. Se o Windows pedir permissão de firewall, permita o Python **somente em redes privadas**. Use sua rede doméstica como privada. Não abra portas no roteador nem habilite acesso público.
7. Mantenha a janela aberta. Ela mostra o endereço do notebook, o endereço do celular e os códigos distintos de pareamento. Digite o código exclusivo do notebook em `https://localhost:8765`.

## Início automático no Windows (opcional, após a instalação inicial)

Para não depender da janela preta, execute **Instalar-ProvaScan-Automatico.bat** uma vez na pasta permanente do projeto. Isso cria, somente para o usuário atual e sem administrador:

- **ProvaScan** na área de trabalho: garante que o servidor está acessível e abre `https://localhost:8765`. Clicar novamente reutiliza o servidor, sem iniciar outra cópia.
- **Conexão ProvaScan** na área de trabalho: abre o registro local com endereços e códigos da inicialização. Os códigos expiram como antes; este arquivo é local e contém informações de pareamento, não deve ser publicado.
- Um atalho na pasta Inicializar do Windows: inicia o servidor em segundo plano ao entrar na conta, sem abrir o navegador ou uma janela preta. O Windows precisa permitir aplicativos de inicialização e a rede pode levar alguns segundos para conectar.

**Para atualizar uma instalação existente:** aguarde Sincronizado e exporte um backup; encerre o servidor antigo; baixe o ZIP atualizado e extraia em uma pasta permanente. Execute o instalador automático acima. Ele reutiliza o ambiente Python existente naquela pasta ou prepara um novo, se necessário (com internet para baixar as dependências). Se usar a pasta antiga, preserve `.venv-lan`. O banco, certificados e sessões permanecem em `%LOCALAPPDATA%\ProvaScan`, fora da pasta do código. Esta atualização do iniciador não é instalada pelo botão de atualização da interface.

Não mova ou apague a pasta do programa após criar os atalhos. Se mover, execute o instalador automático na nova pasta. Ele substitui os atalhos existentes. A área de trabalho é resolvida pelo Windows, inclusive quando redirecionada ao OneDrive.

O servidor só inicia após entrar no Windows, não enquanto o computador estiver desligado, suspenso ou antes do login. Fechar a página não encerra o servidor em segundo plano. Para parar de iniciar junto com o Windows, execute **Desativar-Inicio-Automatico.bat**; isso preserva os dados e os atalhos, e o servidor atual termina quando sair da conta ou desligar o computador. O ícone ProvaScan continua permitindo iniciar por demanda.

Em caso de falha, clique no ícone ProvaScan: ele apresenta o erro. Os registros ficam em `%LOCALAPPDATA%\ProvaScan\servidor.log` e, se houver erro no login, `inicializacao-erro.txt`. Se a porta estiver ocupada por algo que não se identifica como este servidor HTTPS, o iniciador não inicia outra cópia nem ignora o certificado. O modo anterior `Iniciar-ProvaScan-WiFi.bat` permanece disponível para diagnóstico, sem executar os dois modos ao mesmo tempo.

As regras de firewall, certificado do Android e mudança de IP permanecem iguais. Início automático não libera redes públicas nem altera permissões do Windows. Sincronize antes de mudar de rede/endereço.

## 3. Preparar o Android

A câmera precisa de uma conexão HTTPS confiável. Não basta ignorar uma advertência de certificado.

1. Transfira ao celular **somente** `%LOCALAPPDATA%\ProvaScan\certificates\ProvaScan-CA.crt` (cabo USB é uma opção). **Nunca transfira os arquivos `ca-key.pem` ou `server-key.pem`.**
2. Instale como certificado de CA nas configurações do Android. O caminho varia por fabricante; procure “Instalar certificado” e “Certificado de CA”. O Android pode exigir o desbloqueio de tela e mostrar um aviso de confiança. Isso autoriza a CA pessoal deste notebook; não instale certificados de origem desconhecida.
3. Conecte notebook e celular ao mesmo Wi-Fi. Não use a rede de visitantes com isolamento entre aparelhos.
4. Abra no Chrome o endereço HTTPS/IP exibido na janela e digite o código do celular (válido por dez minutos após iniciar o servidor).
5. Autorize a câmera quando usar o scanner. Se houver aviso de certificado, pare e confira a instalação e o IP. Não desligue proteções do navegador.
6. Opcionalmente adicione esse endereço à tela inicial. Ele é diferente do antigo atalho do GitHub.

Se o IP mudar, reinicie o servidor para incluir o endereço novo no certificado e use a nova URL. **O armazenamento offline do navegador pertence ao endereço antigo**: sincronize ou exporte seus dados pendentes antes de mudar de endereço. Reserve o IP do notebook no DHCP do roteador para evitar isso. O certificado raiz continua o mesmo; não precisa ser reinstalado por mudança de IP.

## 4. Migrar e testar

1. No notebook, abra o novo endereço e use **Importar backup**, escolhendo o backup atualizado do app anterior. A importação substitui a cópia local e envia as alterações ao notebook; prefira fazê-la quando o banco local ainda estiver vazio.
2. Aguarde **Sincronizado**. Confira turmas, alunos, avaliações, gabaritos, notas e anulações. As notas com respostas são confirmadas pelo servidor usando o gabarito atual. Conflitos ou notas antigas incompletas precisam de conferência.
3. Abra o endereço do notebook no celular e confirme os mesmos dados. **Não importe o segundo backup indiscriminadamente**: compare diferenças antes, para não substituir registros mais recentes.
4. Faça um cadastro fictício no notebook e confira no celular. Altere no celular e confira no notebook. Exclua o cadastro fictício.
5. Teste uma correção, uma mudança de valor e uma anulação. Confira o recálculo em ambos.
6. Interrompa o Wi-Fi no celular com o app aberto, faça uma alteração de teste, reconecte e confira a confirmação pelo notebook. Se houver alterações concorrentes no mesmo registro, o app pede qual conjunto preservar e oferece backup.
7. Só depois dessa conferência, desconecte e revogue a integração com o Drive no app antigo. O código do site público não é removido automaticamente.

## Operação e limites

- O notebook deve estar ligado, com o servidor aberto e acessível. O celular pode trabalhar com a última cópia carregada; operações aguardam confirmação persistente na fila. **Sincronizado** significa confirmação do servidor, não apenas gravação no celular.
- Sincronização por WebSocket enquanto o app está aberto; Android pode suspender abas em segundo plano. A reconexão ocorre ao reabrir o app. Não é possível prometer execução contínua com o navegador encerrado.
- Não edite em duas abas do mesmo endereço. O app mantém uma única aba de edição por navegador para proteger a fila.
- Alterações remotas aguardam o fim de uma edição ou conferência aberta para não substituir trabalho em andamento. Operações dependentes de uma versão antiga da prova são rejeitadas para revisão, sem descarte automático.
- O banco fica em `%LOCALAPPDATA%\ProvaScan\provascan.sqlite3`, com histórico de operações. Backups SQLite automáticos ficam na subpasta `backups`. Exporte também um backup JSON e copie periodicamente para pendrive: um único notebook não protege contra perda do equipamento.
- Sessões de pareamento persistem no navegador. Ao usar um aparelho compartilhado, use **Desconectar este aparelho** ou remova os dados desse endereço depois de sincronizar/exportar. Reiniciar o servidor renova os códigos de pareamento, mas mantém aparelhos já autorizados.
- Não use esta versão para acesso fora da rede local. O servidor não configura túneis, roteadores ou acesso externo.

## Atualizações separadas dos dados

No notebook, **Procurar atualização** baixa e confere os arquivos oficiais. Só **Autorizar atualização nos aparelhos** troca a versão ativa. Cada aparelho aguarda concluir sua edição e esvaziar a fila antes de recarregar. Um aparelho offline recebe a versão autorizada ao reconectar. A versão anterior é preservada; se a nova não confirmar inicialização em 90 segundos, o servidor retorna à anterior. Também existe a página independente `https://localhost:8765/maintenance` para voltar manualmente.

Atualizações do servidor Python que alterem o protocolo exigem novo pacote e reinício autorizado no Windows. A atualização da interface não instala programas no Android nem contorna permissões do sistema. A instalação inicial e os testes reais no seu notebook/celular ainda precisam ser realizados pelo professor; testes automatizados não substituem essa validação.

## Pacote para outro professor testar

O pacote de teste pode ser gerado com `python tools/build_test_package.py ProvaScan_Instalacao_Teste_Windows.zip`. A montagem usa uma lista fixa de arquivos e verifica o manifesto da interface; não inclui banco, certificados, chaves, ambientes Python, logs ou testes. O ZIP contém `COMECE-AQUI.txt` e `Instalar-ProvaScan.bat`, que realiza a instalação inicial e configura o início automático em uma única sequência. Requer Python 3.12+ com Launcher e internet para instalar dependências. Se Python faltar, o instalador abre o site oficial e orienta a repetir após a instalação.

Cada professor usa seu próprio usuário/notebook, banco e certificado local. Em uma conta Windows que já tenha ProvaScan, os dados existentes são reutilizados. Para iniciar o piloto, use somente dados fictícios e siga o roteiro de teste incluído. O instalador é experimental e não é um executável assinado; a validação real deve ser feita no Windows de destino.
