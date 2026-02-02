; FDE Windows Installer Script
; NSIS Modern User Interface

!include "MUI2.nsh"
!include "WordFunc.nsh"

;-------------------------------------------
; 基本配置
;-------------------------------------------
!define PRODUCT_NAME "FDE"
!define PRODUCT_VERSION "1.4.5"
!define PRODUCT_PUBLISHER "yuchenii"
!define PRODUCT_WEB_SITE "https://github.com/yuchenii/fde"

Name "${PRODUCT_NAME} ${PRODUCT_VERSION}"
OutFile "..\dist\fde-windows-x64-setup.exe"
InstallDir "$LOCALAPPDATA\Programs\FDE"
RequestExecutionLevel user

; 压缩设置 (LZMA 压缩率最高)
SetCompressor /SOLID lzma
SetCompressorDictSize 64

;-------------------------------------------
; 界面设置
;-------------------------------------------
!define MUI_ABORTWARNING
!define MUI_ICON "${NSISDIR}\Contrib\Graphics\Icons\modern-install.ico"
!define MUI_UNICON "${NSISDIR}\Contrib\Graphics\Icons\modern-uninstall.ico"

; 安装页面
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "..\LICENSE"
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

; 卸载页面
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

; 语言
!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

;-------------------------------------------
; 组件描述
;-------------------------------------------
LangString DESC_SecClient ${LANG_SIMPCHINESE} "FDE 客户端 - 用于将本地项目部署到远程服务器"
LangString DESC_SecClient ${LANG_ENGLISH} "FDE Client - Deploy local projects to remote servers"

LangString DESC_SecServer ${LANG_SIMPCHINESE} "FDE 服务端 - 接收部署请求并执行部署脚本"
LangString DESC_SecServer ${LANG_ENGLISH} "FDE Server - Receive deployment requests and execute scripts"

;-------------------------------------------
; 客户端组件 (默认选中)
;-------------------------------------------
Section "客户端 (fde-client)" SecClient
    SetOutPath $INSTDIR
    
    ; 复制客户端文件
    File "..\dist\fde-client-windows-x64.exe"
    
    ; 重命名为 fde-client.exe 方便命令行使用
    Rename "$INSTDIR\fde-client-windows-x64.exe" "$INSTDIR\fde-client.exe"
SectionEnd

;-------------------------------------------
; 服务端组件 (默认不选中)
;-------------------------------------------
Section /o "服务端 (fde-server)" SecServer
    SetOutPath $INSTDIR
    
    ; 复制服务端文件
    File "..\dist\fde-server-windows-x64.exe"
    
    ; 重命名为 fde-server.exe
    Rename "$INSTDIR\fde-server-windows-x64.exe" "$INSTDIR\fde-server.exe"
SectionEnd

;-------------------------------------------
; 公共设置 (始终执行)
;-------------------------------------------
Section "-Common"
    SetOutPath $INSTDIR
    
    ; 创建卸载程序
    WriteUninstaller "$INSTDIR\uninstall.exe"
    
    ;-------------------------------------------
    ; 添加到用户 PATH (强制执行)
    ;-------------------------------------------
    ; 读取当前用户 PATH
    ReadRegStr $0 HKCU "Environment" "Path"
    
    ; 如果 PATH 为空，直接设置为安装目录
    StrCmp $0 "" 0 +3
        StrCpy $0 "$INSTDIR"
        Goto write_path
    
    ; 检查是否已经包含安装目录 (使用 WordFind 精确匹配)
    ${WordFind} $0 ";" "E+1{" $1
    StrCmp $1 $INSTDIR skip_path 0
    ${WordFind} $0 ";" "E+2{" $1
    StrCmp $1 $INSTDIR skip_path 0
    ${WordFind} $0 ";" "E+3{" $1
    StrCmp $1 $INSTDIR skip_path 0
    ; 简单检查: 如果 PATH 完全等于安装目录
    StrCmp $0 $INSTDIR skip_path 0
    
    ; 追加到 PATH
    StrCpy $0 "$0;$INSTDIR"
    
    write_path:
    WriteRegExpandStr HKCU "Environment" "Path" $0
    
    skip_path:
    ; 通知系统环境变量已更改
    SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000
SectionEnd

;-------------------------------------------
; 组件描述绑定
;-------------------------------------------
!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
    !insertmacro MUI_DESCRIPTION_TEXT ${SecClient} $(DESC_SecClient)
    !insertmacro MUI_DESCRIPTION_TEXT ${SecServer} $(DESC_SecServer)
!insertmacro MUI_FUNCTION_DESCRIPTION_END

;-------------------------------------------
; 卸载程序
;-------------------------------------------
Section "Uninstall"
    ; 删除文件
    Delete "$INSTDIR\fde-client.exe"
    Delete "$INSTDIR\fde-server.exe"
    Delete "$INSTDIR\uninstall.exe"
    
    ; 删除安装目录及所有内容 (包括 .old 文件等)
    RMDir /r "$INSTDIR"
    
    ;-------------------------------------------
    ; 从用户 PATH 中安全移除 FDE 路径
    ; 注意: 只操作 HKCU\Environment\Path 这一个键
    ; 不会影响其他环境变量或系统级 PATH
    ;-------------------------------------------
    ReadRegStr $0 HKCU "Environment" "Path"
    StrCmp $0 "" path_done  ; PATH 为空则跳过
    
    ; 保存原始 PATH 到 $5 用于安全检查
    StrCpy $5 $0
    
    ; 创建要搜索的精确模式 (只匹配完整路径，不会误删其他路径)
    StrCpy $2 ";$INSTDIR"  ; 模式1: ;C:\Users\xxx\AppData\Local\FDE (中间或末尾)
    StrCpy $3 "$INSTDIR;"  ; 模式2: C:\Users\xxx\AppData\Local\FDE; (开头)
    
    ;-------------------------------------------
    ; 模式1: 移除 ";C:\Users\xxx\AppData\Local\FDE"
    ; 适用于: PATH = "C:\Other;C:\Users\xxx\AppData\Local\FDE"
    ; 结果:   PATH = "C:\Other"
    ;-------------------------------------------
    ${WordReplace} $0 $2 "" "+" $4
    StrCmp $0 $4 try_pattern2  ; 没变化则尝试下一模式
    StrCpy $0 $4
    Goto write_new_path
    
    try_pattern2:
    ;-------------------------------------------
    ; 模式2: 移除 "C:\Users\xxx\AppData\Local\FDE;"
    ; 适用于: PATH = "C:\Users\xxx\AppData\Local\FDE;C:\Other"
    ; 结果:   PATH = "C:\Other"
    ;-------------------------------------------
    ${WordReplace} $0 $3 "" "+" $4
    StrCmp $0 $4 try_exact  ; 没变化则尝试精确匹配
    StrCpy $0 $4
    Goto write_new_path
    
    try_exact:
    ;-------------------------------------------
    ; 模式3: 精确匹配 (PATH 只有 FDE 这一个值)
    ; 适用于: PATH = "C:\Users\xxx\AppData\Local\FDE"
    ; 结果:   删除整个 Path 键
    ;-------------------------------------------
    StrCmp $0 $INSTDIR clear_path path_done  ; 不匹配则不修改
    
    clear_path:
    ; 只有当 PATH 完全等于 $INSTDIR 时才删除键
    DeleteRegValue HKCU "Environment" "Path"
    Goto path_done
    
    write_new_path:
    ; 安全检查: 确保新路径不为空且确实发生了变化
    StrCmp $0 "" path_done    ; 新路径为空则不写入
    StrCmp $0 $5 path_done    ; 没变化则不写入
    WriteRegExpandStr HKCU "Environment" "Path" $0
    
    path_done:
    ; 通知系统环境变量已更改
    SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000
SectionEnd
