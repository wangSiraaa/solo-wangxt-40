import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CatalogService } from './catalog.service';

@Controller('api/catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('creators')
  creators() {
    return this.catalog.listCreators();
  }

  @Post('creators')
  createCreator(@Body() body: { name: string; payoutAccount?: string }) {
    return this.catalog.createCreator(body);
  }

  @Get('works')
  works() {
    return this.catalog.listWorks();
  }

  @Post('works')
  createWork(
    @Body() body: { title: string; isrc: string; artist?: string },
  ) {
    return this.catalog.createWork(body);
  }

  @Get('contracts')
  contracts(@Query('workId') workId?: string) {
    return this.catalog.listContracts(workId);
  }

  @Post('contracts')
  createContract(@Body() body: any) {
    return this.catalog.createContract(body);
  }

  @Get('rates')
  rates() {
    return this.catalog.listRates();
  }

  @Post('rates')
  createRate(
    @Body()
    body: {
      currency: string;
      effectiveFrom: string;
      effectiveTo?: string | null;
      rateToCny: string;
    },
  ) {
    return this.catalog.createRate(body);
  }

  @Get('pending')
  pending() {
    return this.catalog.pendingRows();
  }

  /** 待处理区：为未知 ISRC 建作品映射 */
  @Post('pending/:rowId/resolve-isrc')
  resolveIsrc(
    @Param('rowId') rowId: string,
    @Body() body: { isrc?: string; title?: string; artist?: string; workId?: string },
  ) {
    return this.catalog.resolveIsrc(rowId, body);
  }

  /** 补录汇率/合同后，手动触发全部待处理行重新评估 */
  @Post('pending/reprocess')
  reprocess() {
    return this.catalog.reprocess();
  }
}
