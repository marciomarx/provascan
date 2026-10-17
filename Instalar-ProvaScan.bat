@echo off
setlocal
cd /d "%~dp0"
title Instalar ProvaScan - versao de teste
 echo PROVASCAN - INSTALACAO DE TESTE
 echo.
 echo Este instalador prepara o programa, cria atalhos e ativa o inicio
 echo automatico para seu usuario do Windows. Os dados ficam neste notebook.
 echo Nenhuma turma, aluno ou nota de outro professor acompanha o pacote.
 echo.
choice /c SN /m "Deseja instalar o ProvaScan neste computador?"
if errorlevel 2 exit /b 0
if not exist ".venv-lan\Scripts\python.exe" (
 where py >nul 2>&1
 if errorlevel 1 goto :python
 py -3 -m venv .venv-lan
 if errorlevel 1 goto :failure
)
.venv-lan\Scripts\python.exe -c "import sys; assert sys.version_info[0:2].__ge__((3,12)), 'Instale Python 3.12 ou superior'"
if errorlevel 1 goto :python
if not exist ".venv-lan\deps-ready" (
 .venv-lan\Scripts\python.exe -m pip install -r local\requirements.txt
 if errorlevel 1 goto :failure
 type nul > .venv-lan\deps-ready
)
.venv-lan\Scripts\python.exe local\server.py --cert-only
if errorlevel 1 goto :failure
echo.
echo O certificado acima foi criado NESTE notebook para a camera por HTTPS.
echo Confira o nome ProvaScan - autoridade pessoal no aviso do Windows.
echo Nunca compartilhe os arquivos ca-key.pem ou server-key.pem.
choice /c SN /m "Confiar neste certificado pessoal do ProvaScan?"
if errorlevel 2 exit /b 0
certutil -user -addstore Root "%LOCALAPPDATA%\ProvaScan\certificates\ProvaScan-CA.crt"
if errorlevel 1 goto :failure
start "" ".venv-lan\Scripts\pythonw.exe" "local\launcher.py" --install
exit /b 0
:python
echo.
echo Instale Python 3.12 ou superior pelo site oficial.
echo No instalador, inclua o Python Launcher. Depois execute este arquivo novamente.
start "" "https://www.python.org/downloads/windows/"
pause
exit /b 1
:failure
echo.
echo A instalacao nao terminou. Envie uma foto desta janela ao responsavel pelo teste.
echo Nao exclua certificados nem o banco de uma instalacao anterior.
pause
exit /b 1
