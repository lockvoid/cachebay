<script lang="ts">
  import { goto } from "$app/navigation";
  import { useSpellQuery } from "$lib/queries/spell";
  import { useUpdateSpell } from "$lib/queries/updateSpell";
  import { useDeleteSpell } from "$lib/queries/deleteSpell";
  import SpellForm from "./SpellForm.svelte";
  import SpellSkeleton from "./SpellSkeleton.svelte";

  let { spellId }: { spellId: string } = $props();

  const spellQuery = useSpellQuery(() => spellId);
  const updateSpell = useUpdateSpell();
  const deleteSpell = useDeleteSpell();

  const handleSubmit = async (values: any) => {
    try {
      const result = await updateSpell.execute({
        input: { ...values, id: spellId },
      });

      if (result?.error) {
        throw result.error;
      }

      await goto(`/spells/${spellId}`);
    } catch (error) {
      console.error(error);
      alert("An error occurred. Please try again.");
    }
  };

  const handleDelete = async () => {
    const confirmation = confirm("Are you sure you want to delete this spell?");

    if (!confirmation) return;

    try {
      const result = await deleteSpell.execute({
        input: { id: spellId },
      });

      if (result?.error) {
        throw result.error;
      }

      await goto("/");
    } catch (error) {
      console.error(error);
      alert("An error occurred. Please try again.");
    }
  };
</script>

<div class="mx-auto flex max-w-3xl flex-col space-y-6">
  {#if spellQuery.isFetching && !spellQuery.data}
    <SpellSkeleton />
  {:else if spellQuery.data?.spell}
    <a href="/spells/{spellQuery.data.spell.id}" class="a text-sm">
      &larr; Back to spell
    </a>

    <div class="bg-white shadow-sm sm:rounded-lg">
      <h3 class="border-b border-gray-200 p-6 text-lg font-semibold">
        Edit spell
      </h3>

      <div class="p-6 sm:p-6">
        <SpellForm spell={spellQuery.data.spell} onsubmit={handleSubmit} ondelete={handleDelete} />
      </div>
    </div>
  {/if}
</div>
