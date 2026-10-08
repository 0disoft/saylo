<script lang="ts">
  import { getI18n } from '#lib/i18n.ts';
  const i18n = getI18n();
</script>

<section class="intro">
  <p class="eyebrow">SHARED LAYOUT</p>
  <h1>{$i18n.t('demo:aboutHeading')}</h1>
  <p>{$i18n.t('demo:aboutBody')}</p>
</section>
