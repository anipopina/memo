<script setup lang="ts">
defineProps<{
  name:
    | 'add'
    | 'close'
    | 'search'
    | 'openInNew'
    | 'menu'
    | 'delete'
    | 'keyboardTabRtl'
    | 'keyboardTab'
    | 'passkey'
    | 'iosShare';
}>();
</script>
<template>
  <span class="material-icon" :class="`icon-${name}`" aria-hidden="true"></span>
</template>
<style scoped>
.material-icon {
  display: inline-block;
  width: 24px;
  height: 24px;
  flex: none;
  vertical-align: middle;
  background-color: currentColor;
  -webkit-mask: var(--icon) center / contain no-repeat;
  mask: var(--icon) center / contain no-repeat;
}
.icon-add {
  --icon: url('../assets/material-symbols/add.svg');
}
.icon-close {
  --icon: url('../assets/material-symbols/close.svg');
}
.icon-search {
  --icon: url('../assets/material-symbols/search.svg');
}
.icon-openInNew {
  --icon: url('../assets/material-symbols/open_in_new.svg');
}
.icon-menu {
  --icon: url('../assets/material-symbols/menu.svg');
}
.icon-delete {
  --icon: url('../assets/material-symbols/delete.svg');
}
.icon-keyboardTabRtl {
  --icon: url('../assets/material-symbols/keyboard_tab_rtl.svg');
}
.icon-keyboardTab {
  --icon: url('../assets/material-symbols/keyboard_tab.svg');
}
.icon-passkey {
  --icon: url('../assets/material-symbols/passkey.svg');
}
.icon-iosShare {
  --icon: url('../assets/material-symbols/ios_share.svg');
}
</style>
