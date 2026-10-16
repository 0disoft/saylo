<script lang="ts">
  import { getI18nSelector } from './i18n';
  const locale = getI18nSelector(snapshot => snapshot.locale);
</script>

<span id="selected-locale">{$locale}</span>
