<script lang="ts">
  import { goto } from "$app/navigation";
  import { getSettings } from "$lib/stores/settings.svelte";
  import { useCreateSpell } from "$lib/queries/createSpell";
  import SpellForm from "./SpellForm.svelte";

  const settings = getSettings();
  const createSpell = useCreateSpell();

  const handleCreate = async (input: any) => {
    if (settings.optimistic) {
      createSpell.execute({ input });

      await goto("/");
    } else {
      try {
        await createSpell.execute({ input });

        await goto("/");
      } catch (error) {
        console.error(error);
        alert("An error occurred. Please try again.");
      }
    }
  };
</script>

<div class="mx-auto flex max-w-3xl flex-col space-y-6">
  <a href="/" class="a text-sm">
    &larr; Back to spells
  </a>

  <div class="bg-white shadow-sm sm:rounded-lg">
    <h3 class="border-b border-gray-200 p-6 text-lg font-semibold">
      New spell
    </h3>

    <div class="p-6 sm:p-6">
      <SpellForm spell={{ name: "", effect: "", category: "" }} onsubmit={handleCreate} />
    </div>
  </div>
</div>
