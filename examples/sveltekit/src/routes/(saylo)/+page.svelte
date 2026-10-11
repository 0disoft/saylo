<script lang="ts">
  import { getDemoView } from '#lib/demo-messages.ts';
  const view = getDemoView();
  const text = $derived(view.current.messages);
</script>

<section class="intro">
  <p class="eyebrow">SVELTEKIT LIVE CATALOG PREVIEW</p>
  <h1>{text.heading}</h1>
  <p>{text.description}</p>
  <p class="hint">입력과 확인 창은 공통 layout에 두어 페이지를 이동해도 유지합니다.</p>
</section>
