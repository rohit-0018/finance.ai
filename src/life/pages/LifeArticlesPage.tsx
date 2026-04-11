// Articles inside Life. Thin wrapper that renders the existing papermind
// ArticlesPage inside LifeLayout's chrome, so admins see Articles as part
// of their Life workspace instead of the main papermind sidebar.
import React from 'react'
import LifeLayout from '../LifeLayout'
import ArticlesPage from '../../pages/ArticlesPage'

const LifeArticlesPage: React.FC = () => (
  <LifeLayout title="Articles">
    <ArticlesPage hideIngest />
  </LifeLayout>
)

export default LifeArticlesPage
