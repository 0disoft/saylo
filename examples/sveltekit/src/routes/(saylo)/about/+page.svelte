<script lang="ts">
  import { getDemoView } from '#lib/demo-messages.ts';
  const view = getDemoView();
  const text = $derived(view.current.messages);
</script>

<section class="intro">
  <p class="eyebrow" lang="en">SHARED LAYOUT</p>
  <h1>{text.aboutHeading}</h1>
  <p>{text.aboutBody}</p>
</section>
