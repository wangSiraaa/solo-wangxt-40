import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ImportService } from './import.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StatementRow } from '../entities/statement-row.entity';
import { BillImport } from '../entities/bill-import.entity';
import { D, formatCny } from '../common/money.util';

@Controller('api/imports')
export class ImportController {
  constructor(
    private readonly importService: ImportService,
    @InjectRepository(StatementRow)
    private readonly rowRepo: Repository<StatementRow>,
    @InjectRepository(BillImport)
    private readonly billRepo: Repository<BillImport>,
  ) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async upload(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('请上传 CSV 文件（字段名 file）');
    return this.importService.importCsv(file.originalname, file.buffer);
  }

  @Get()
  listImports() {
    return this.billRepo.find({ order: { importedAt: 'DESC' } });
  }

  /** 全部账单原始行（平台视图），支持按状态/平台过滤 */
  @Get('rows')
  async listRows(
    @Query('status') status?: string,
    @Query('platform') platform?: string,
  ) {
    const where: any = {};
    if (status) where.status = status;
    if (platform) where.platform = platform;
    const rows = await this.rowRepo.find({
      where,
      relations: { billImport: true },
      order: { periodEnd: 'ASC', platform: 'ASC', platformLineId: 'ASC' },
    });
    const totalCny = rows
      .filter((r) => r.cnyCents !== null)
      .reduce((acc, r) => acc.plus(D(r.cnyCents!)), D(0));
    return {
      count: rows.length,
      totalConvertedCnyCents: totalCny.toFixed(0),
      totalConvertedCny: formatCny(totalCny),
      rows,
    };
  }

  @Get('rows/:id')
  getRow(@Param('id') id: string) {
    return this.rowRepo.findOne({
      where: { id },
      relations: { billImport: true, allocations: { creator: true, batch: true } },
    });
  }
}
