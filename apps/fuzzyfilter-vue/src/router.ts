/**
 * Vue Router Configuration
 * 
 * Routes for the FuzzyFilter Vue example application.
 */
import { createRouter, createWebHistory } from "vue-router"
import DemoPage from "./components/DemoPage.vue"
import AlgorithmExplainer from "./components/AlgorithmExplainer.vue"

const routes = [
  {
    path: "/",
    name: "demo",
    component: DemoPage,
  },
  {
    path: "/explainer",
    name: "explainer",
    component: AlgorithmExplainer,
  },
]

export const router = createRouter({
  history: createWebHistory('/vue/'),
  routes,
})
