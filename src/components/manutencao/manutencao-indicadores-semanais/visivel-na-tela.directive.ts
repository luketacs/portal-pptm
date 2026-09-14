import { Directive, ElementRef, OnDestroy, OnInit, Renderer2 } from '@angular/core';

// Adiciona a classe "pcm-em-vista" no próprio elemento na primeira vez que ele entra
// na viewport (rolagem), depois para de observar — usado pelos gráficos de Evolução
// (a maioria começa abaixo da dobra) pra disparar a animação de "desenhar a linha"
// só quando o usuário rola até eles, em vez de todos de uma vez ao carregar a página
// (que é como os cards de KPI no topo já se comportam, e continuam se comportando —
// esses já estão visíveis de cara, não precisam de gatilho de rolagem).
@Directive({
  selector: '[appVisivelNaTela]',
  standalone: true,
})
export class VisivelNaTelaDirective implements OnInit, OnDestroy {
  private observer: IntersectionObserver | null = null;

  constructor(private el: ElementRef<HTMLElement>, private renderer: Renderer2) {}

  ngOnInit(): void {
    this.observer = new IntersectionObserver(
      entries => {
        if (entries[0]?.isIntersecting) {
          this.renderer.addClass(this.el.nativeElement, 'pcm-em-vista');
          this.observer?.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    this.observer.observe(this.el.nativeElement);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }
}
