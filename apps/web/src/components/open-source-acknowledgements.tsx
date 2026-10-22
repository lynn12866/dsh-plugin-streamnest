import { LuExternalLink } from 'react-icons/lu';

import references from '../../../../assets/reference-projects.json';
import { t } from '../i18n';

const projects = Object.values(references);

export function OpenSourceAcknowledgements() {
  return (
    <section className="mv-settings-section" aria-labelledby="mv-open-source-heading">
      <h2 id="mv-open-source-heading">{t('credits.title')}</h2>
      <p className="mv-reference-projects mv-muted">
        <span>{t('credits.introduction')}</span>
        {projects.map((project) => (
          <a
            className="mv-reference-link mv-muted"
            key={project.url}
            href={project.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {project.name}
            <LuExternalLink size={14} aria-hidden />
          </a>
        ))}
      </p>
    </section>
  );
}
