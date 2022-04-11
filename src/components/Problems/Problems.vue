<template>
  <div>
    <v-container>
      <v-tabs v-model="currentTab">
        <v-tab v-for="tab in problems" :key="tab.title" ripple>
          {{ tab.title }}
        </v-tab>
      </v-tabs>
      <ul v-if="problems.length" style="margin-top: 16px">
        <template v-for="problem in problems[currentTab].problems">
          <li :key="problem.route">
            <a v-if="problem.target === 'plugin'" @click="onGoto(problem.route, problem.range)">
              {{problem.title}}
            </a>
            <router-link v-else-if="!problem.target"
                :to="problem.route">{{problem.title}}
            </router-link>
            <a v-else :href="problem.route" :target="problem.target">
              {{problem.title}}
            </a>
          </li>
        </template>
      </ul>
    </v-container>
  </div>
</template>

<script>

export default {
  name: 'Problems',
  methods: {
    onGoto(route, range) {
      window.$PAPI.goto(route, undefined, undefined, range);
    }
  },
  computed: {
    problems() {
      const tabs = {};
      this.$store.state.problems.map((item) => {
        !tabs[item.problem] && (tabs[item.problem] = []);
        tabs[item.problem].push(item);
      });

      const result = [];
      for (const tab in tabs) {
        result.push({
          title: tab,
          problems: tabs[tab]
        });
      }
      return result;
    }
  },
  props: {
  },
  data() {
    return {
      currentTab: 0
    };
  }
};
</script>

<style scoped>
</style>
