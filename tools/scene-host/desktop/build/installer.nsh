!macro customInstall
  CreateShortCut "$DESKTOP\ThreeJSON Scene Editor.lnk" "$INSTDIR\ThreeJSON Scene Host.exe" "--editor"
  CreateShortCut "$DESKTOP\ThreeJSON Scene Player.lnk" "$INSTDIR\ThreeJSON Scene Host.exe" "--player"
  CreateDirectory "$SMPROGRAMS\ThreeJSON Scene Host"
  CreateShortCut "$SMPROGRAMS\ThreeJSON Scene Host\ThreeJSON Scene Editor.lnk" "$INSTDIR\ThreeJSON Scene Host.exe" "--editor"
  CreateShortCut "$SMPROGRAMS\ThreeJSON Scene Host\ThreeJSON Scene Player.lnk" "$INSTDIR\ThreeJSON Scene Host.exe" "--player"
!macroend

!macro customUnInstall
  Delete "$DESKTOP\ThreeJSON Scene Editor.lnk"
  Delete "$DESKTOP\ThreeJSON Scene Player.lnk"
  Delete "$SMPROGRAMS\ThreeJSON Scene Host\ThreeJSON Scene Editor.lnk"
  Delete "$SMPROGRAMS\ThreeJSON Scene Host\ThreeJSON Scene Player.lnk"
  RMDir "$SMPROGRAMS\ThreeJSON Scene Host"
!macroend
